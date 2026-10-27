"""Integration checks against an isolated local PostgreSQL container only.

Create it with the command in ../README.md before running this script.
This script never connects to a hosted Supabase project.
"""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import uuid


CONTAINER = "number-select-reviews-validation"
ROOT = Path(__file__).resolve().parents[1]
PASSED = 0


def run_sql(sql, role=None, expect_error=False):
    if role:
        sql = f"set role {role};\n" + sql
    result = subprocess.run(
        [
            "docker", "exec", "--interactive", CONTAINER,
            "psql", "--username", "postgres", "--dbname", "postgres",
            "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet",
        ],
        input=sql, text=True, capture_output=True,
    )
    if expect_error:
        assert result.returncode != 0 and "permission denied" in result.stderr, result.stderr
        return result.stderr
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def literal(value):
    return "null" if value is None else "'" + str(value).replace("'", "''") + "'"


def call(name, *values, role="anon"):
    result = run_sql(f"select public.{name}({','.join(literal(v) for v in values)});", role)
    return json.loads(result) if result else None


def check(name, value):
    global PASSED
    assert value, name
    PASSED += 1
    print("PASS", name, flush=True)


def error_code(result):
    return result.get("error", {}).get("code") if isinstance(result, dict) else None


def has_secret_key(value):
    if isinstance(value, dict):
        return any("password" in key.lower() or has_secret_key(item) for key, item in value.items())
    if isinstance(value, list):
        return any(has_secret_key(item) for item in value)
    return False


def main():
    image = subprocess.check_output(
        ["docker", "inspect", "--format", "{{.Config.Image}} {{.HostConfig.NetworkMode}}", CONTAINER],
        text=True,
    ).strip()
    assert image == "postgres:17-alpine none", "Use the documented isolated validation container."
    run_sql("truncate reviews_private.posts, reviews_private.request_limits;")

    password = "가" * 30 + "tail-correct"
    wrong_password = "가" * 30 + "tail-wrong"
    content = "유용하게 쓰고 있습니다.\n<img src=x onerror=alert(1)>"
    post = call("review_create", "  첫방문  ", "  사용 후기  ", content, password)
    check("anonymous post creation persists trimmed fields", post["nickname"] == "첫방문" and post["title"] == "사용 후기" and post["content"] == content)
    post_id = post["id"]
    uuid.UUID(post_id)
    check("created/read/list results never expose password fields", not has_secret_key(post))
    listing = call("reviews_list", 5, 0)
    check("safe newest-post list and total", listing["total"] == 1 and listing["items"][0]["id"] == post_id and "content" not in listing["items"][0] and not has_secret_key(listing))
    check("public detail contains the stored post", call("review_get", post_id) == post)
    check("missing detail returns null", call("review_get", str(uuid.uuid4())) is None)
    check("authenticated role has the same safe public interface", call("review_get", post_id, role="authenticated") == post)

    stored_hash = run_sql(f"select password_hash from reviews_private.posts where id={literal(post_id)};")
    check("bcrypt hash is stored, never plaintext", stored_hash.startswith("$2") and len(stored_hash) == 60 and stored_hash != password)
    run_sql("select password_hash from reviews_private.posts;", "anon", expect_error=True)
    check("anonymous table reads are denied", True)
    run_sql("update reviews_private.posts set title='tamper';", "anon", expect_error=True)
    check("anonymous direct writes are denied", True)
    run_sql("select reviews_private.hash_password('12345678');", "anon", expect_error=True)
    check("private helper execution is denied", True)
    run_sql("do $$begin if not exists(select from pg_roles where rolname='review_no_grants') then create role review_no_grants nologin; end if; end$$;")
    run_sql(f"select public.review_get({literal(post_id)});", "review_no_grants", expect_error=True)
    check("PUBLIC default execute permission is revoked", True)

    wrong = call("review_update", post_id, "누군가", "바뀐 제목", "변조", wrong_password)
    check("Unicode passwords differing after byte72 remain distinct", error_code(wrong) == "REVIEW_PASSWORD_INCORRECT")
    check("failed password attempt commits its counter", run_sql(f"select attempts from reviews_private.request_limits where bucket='password:{post_id}';") == "1")
    check("wrong password leaves post unchanged", call("review_get", post_id) == post)
    updated = call("review_update", post_id, "수정닉네임", "수정한 제목", "수정한 내용", password)
    check("correct password allows update", updated["title"] == "수정한 제목" and updated["content"] == "수정한 내용")
    check("update keeps existing password hash", run_sql(f"select password_hash from reviews_private.posts where id={literal(post_id)};") == stored_hash)
    check("successful password check clears attempt bucket", run_sql(f"select count(*) from reviews_private.request_limits where bucket='password:{post_id}';") == "0")

    for name, title, text, secret in [
        (" ", "제목", "내용", "12345678"),
        ("닉네임", "제" * 81, "내용", "12345678"),
        ("닉네임", "제목", "내" * 4001, "12345678"),
        ("닉네임", "제목", "내용", "1234567"),
        ("닉\n네임", "제목", "내용", "12345678"),
        (None, "제목", "내용", "12345678"),
    ]:
        run_sql("truncate reviews_private.request_limits;")
        assert error_code(call("review_create", name, title, text, secret)) == "REVIEW_INVALID_INPUT"
    check("server-side limits reject missing/oversized fields and short passwords", True)

    run_sql("truncate reviews_private.request_limits;")
    for _ in range(8):
        assert error_code(call("review_delete", post_id, wrong_password)) == "REVIEW_PASSWORD_INCORRECT"
    check("eight failures persist across separate requests", run_sql(f"select attempts from reviews_private.request_limits where bucket='password:{post_id}';") == "8")
    check("further password checks are blocked", error_code(call("review_delete", post_id, password)) == "REVIEW_RATE_LIMITED")
    check("rate-limited attempts cannot delete the post", call("review_get", post_id)["id"] == post_id)
    run_sql(f"update reviews_private.request_limits set window_started_at=clock_timestamp()-interval '16 minutes' where bucket='password:{post_id}';")
    check("expired attempt window permits correct delete", call("review_delete", post_id, password) == {"deleted": True})
    check("deleted post is absent", call("review_get", post_id) is None)

    run_sql("truncate reviews_private.request_limits;")
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda index: call("review_create", "동시테스트", f"후기 {index}", "동시 작성", "test-password"), range(16)))
    check("concurrent creates respect shared cap atomically", sum("id" in result for result in results) == 12 and sum(error_code(result) == "REVIEW_RATE_LIMITED" for result in results) == 4)
    page1, page2 = call("reviews_list", 5, 0), call("reviews_list", 5, 5)
    check("pagination returns disjoint pages with consistent total", len(page1["items"]) == len(page2["items"]) == 5 and page1["total"] == page2["total"] == 12 and not ({post["id"] for post in page1["items"]} & {post["id"] for post in page2["items"]}))
    before = call("reviews_list", 20, 0)
    run_sql((ROOT / "schema.sql").read_text())
    check("re-running migration preserves existing posts", call("reviews_list", 20, 0) == before)
    check("RLS remains enabled on both private tables", run_sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='reviews_private' and c.relkind='r' and c.relrowsecurity;") == "2")
    check("all five public RPCs have definer boundary and fixed search path", run_sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reviews_list','review_get','review_create','review_update','review_delete') and p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig);") == "5")
    print(json.dumps({"passed": PASSED, "failed": 0}), flush=True)


if __name__ == "__main__":
    main()
