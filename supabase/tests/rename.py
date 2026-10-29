"""Exercise the deployed-to-renamed migration in isolated PostgreSQL only.

Requires Docker, the locally cached postgres:17-alpine image, and git history
containing the pre-rename commit 09f54c9. Never contacts a hosted project.
"""

import json
from pathlib import Path
import subprocess
import time


ROOT = Path(__file__).resolve().parents[2]
CONTAINER = "number-select-rename-validation"
MIGRATION = ROOT / "supabase/migrations/20261029_rename_admin_tables.sql"
PASSED = 0
PUBLIC_FUNCTIONS = (
    "reviews_list", "review_get", "review_create", "review_update",
    "review_delete", "reviews_config", "draw_result_get",
)


def sql(command, role=None, database="postgres", expect_error=False):
    if role:
        command = f"set role {role};\n" + command
    result = subprocess.run(
        ["docker", "exec", "--interactive", CONTAINER, "psql", "--username", "postgres",
         "--dbname", database, "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet"],
        input=command, text=True, capture_output=True,
    )
    if expect_error:
        assert result.returncode != 0, "Expected this isolated database operation to fail"
        return result.stderr
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def literal(value):
    return "null" if value is None else "'" + str(value).replace("'", "''") + "'"


def call(name, *args, database="postgres", role="anon"):
    result = sql(f"select public.{name}({','.join(literal(value) for value in args)});", role, database)
    return json.loads(result) if result else None


def check(label, condition):
    global PASSED
    assert condition, label
    PASSED += 1
    print("PASS", label, flush=True)


def error_code(value):
    return value.get("error", {}).get("code") if isinstance(value, dict) else None


def git_file(path):
    return subprocess.check_output(["git", "show", "09f54c9:" + path], cwd=ROOT, text=True)


def old_database(name):
    subprocess.run(["docker", "exec", CONTAINER, "createdb", "--username", "postgres", name], check=True, capture_output=True)
    # Broad defaults model Supabase; the existing app narrows its own grants.
    sql("alter default privileges grant all on tables to anon,authenticated,service_role; "
        "alter default privileges grant execute on functions to anon,authenticated,service_role;", database=name)
    sql(git_file("supabase/schema.sql"), database=name)
    sql(git_file("supabase/migrations/20261029_admin_draw_results.sql"), database=name)
    return name


def snapshot(database, review_schema, draw_table):
    return {
        "posts": sql(f"select jsonb_agg(to_jsonb(p) order by id) from {review_schema}.posts p;", database=database),
        "limits": sql(f"select jsonb_agg(to_jsonb(r) order by bucket) from {review_schema}.request_limits r;", database=database),
        "draws": sql(f"select jsonb_agg(to_jsonb(d) order by draw_no) from {draw_table} d;", database=database),
    }


def object_metadata(database, review_schema, draw_schema, draw_table_name):
    names = [review_schema, draw_schema]
    schemas = ",".join(literal(name) for name in names)
    public_functions = ",".join(literal(name) for name in PUBLIC_FUNCTIONS)
    # Names intentionally change; compare identities and permission/security data.
    return {
        "schemas": sql(f"select jsonb_agg(jsonb_build_array(oid,nspowner,nspacl) order by oid) from pg_namespace where nspname in ({schemas});", database=database),
        "tables": sql(f"select jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ({schemas}) and c.relkind='r';", database=database),
        "functions": sql(f"select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ({schemas}) or(n.nspname='public' and p.proname in ({public_functions}));", database=database),
        "trigger": sql(f"select jsonb_agg(jsonb_build_array(oid,tgrelid,tgfoid,tgtype,tgenabled) order by oid) from pg_trigger where tgrelid={literal(draw_schema+'.'+draw_table_name)}::regclass and not tgisinternal;", database=database),
    }


def main():
    created = False
    try:
        subprocess.run(["docker", "run", "--detach", "--rm", "--pull", "never", "--name", CONTAINER,
                        "--network", "none", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"],
                       check=True, capture_output=True, text=True)
        created = True
        for _ in range(75):
            ready = subprocess.run(["docker", "exec", CONTAINER, "pg_isready", "--host", "127.0.0.1", "--username", "postgres"], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(.2)
        else:
            raise AssertionError("Isolated PostgreSQL did not become ready")
        info = json.loads(subprocess.check_output(["docker", "inspect", CONTAINER], text=True))[0]
        assert info["Config"]["Image"] == "postgres:17-alpine" and info["HostConfig"]["NetworkMode"] == "none" and not info["HostConfig"].get("PortBindings")
        sql("create role anon nologin; create role authenticated nologin; create role service_role nologin; create role rename_no_grants nologin;")
        migration = MIGRATION.read_text()

        database = old_database("rename_main")
        pin = "0381"
        post = call("review_create", "이전 작성자", "기존 제목", "이름 변경 후에도 남을 내용", pin, database=database)
        post_id = post["id"]
        legacy_password = "가" * 30 + "legacy-correct"
        legacy_id = sql("insert into reviews_private.posts(nickname,title,content,password_hash) values ('기존회원','긴 비밀번호','유지할 글',reviews_private.hash_password(" + literal(legacy_password) + ")) returning id;", database=database)
        assert error_code(call("review_delete", post_id, "9381", database=database)) == "REVIEW_PASSWORD_INCORRECT"
        sql("update draws_private.draws set n1=7 where draw_no=1247;", database=database)
        before = snapshot(database, "reviews_private", "draws_private.draws")
        metadata_before = object_metadata(database, "reviews_private", "draws_private", "draws")
        sql(migration, database=database)
        check("all post fields, hashes, timestamps, limits and draw corrections survive rename exactly", snapshot(database, "aareview_private", "aalotto_number.lotto") == before)
        check("table/schema/function identities, ACLs, RLS and trigger identity survive rename", object_metadata(database, "aareview_private", "aalotto_number", "lotto") == metadata_before)
        check("old schema and table names disappear and target names exist", sql("select to_regnamespace('reviews_private') is null and to_regnamespace('draws_private') is null and to_regclass('aalotto_number.lotto') is not null and to_regclass('aareview_private.posts') is not null;", database=database) == "t")
        check("rewritten app function bodies contain no old schema qualifiers", sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','aareview_private','aalotto_number') and (p.prosrc like '%reviews_private.%' or p.prosrc like '%draws_private.%' or p.prosrc like '%aalotto_number.draws%');", database=database) == "0")
        for _ in range(2):
            sql(migration, database=database)
            assert snapshot(database, "aareview_private", "aalotto_number.lotto") == before
            assert object_metadata(database, "aareview_private", "aalotto_number", "lotto") == metadata_before
        check("repeated rename leaves all data and permission metadata unchanged", True)

        check("public review list/get/config keep their contracts", call("review_get", post_id, database=database) == post and call("reviews_list", 20, 0, database=database)["total"] == 2 and call("reviews_config", database=database) == {"password_digits": 4})
        assert error_code(call("review_update", post_id, "변조", "변조", "변조", "9381", database=database)) == "REVIEW_PASSWORD_INCORRECT"
        check("wrong PIN still fails and its counter persists after rename", sql("select attempts from aareview_private.request_limits where bucket=" + literal("password:" + post_id) + ";", database=database) == "2")
        saved_hash = sql("select password_hash from aareview_private.posts where id=" + literal(post_id) + ";", database=database)
        updated = call("review_update", post_id, "수정 작성자", "수정 제목", "정상 수정", pin, database=database)
        check("correct PIN edits without changing the stored password hash", updated["content"] == "정상 수정" and sql("select password_hash from aareview_private.posts where id=" + literal(post_id) + ";", database=database) == saved_hash)
        check("legacy long password remains usable", call("review_update", legacy_id, "기존회원", "수정", "기존 비밀번호 유지", legacy_password, database=database)["content"] == "기존 비밀번호 유지" and call("review_delete", legacy_id, legacy_password, database=database) == {"deleted": True})
        fresh = call("review_create", "새 작성자", "새 제목", "새 글", "0123", database=database)
        check("new four-digit posts can be created and deleted", "id" in fresh and call("review_delete", fresh["id"], "0123", database=database) == {"deleted": True})
        check("original post can still be deleted using its PIN", call("review_delete", post_id, pin, database=database) == {"deleted": True})

        draw = call("draw_result_get", None, database=database)
        check("latest and exact draw RPCs retain corrected result data", draw["winning_numbers"][0] == 7 and call("draw_result_get", 1247, database=database) == draw and call("draw_result_get", 999999, database=database) is None)
        sql("update aalotto_number.lotto set n1=6 where draw_no=1247;", database=database)
        changed = call("draw_result_get", 1247, database=database)
        check("owner table edits and timestamp trigger work with the renamed table", changed["winning_numbers"][0] == 6 and changed["updated_at"] != draw["updated_at"])
        for role in ["anon", "authenticated"]:
            for command in ["select * from aalotto_number.lotto;", "update aalotto_number.lotto set n1=1;", "select password_hash from aareview_private.posts;", "delete from aareview_private.posts;", "select aareview_private.hash_password('0123');", "select aalotto_number.touch_updated_at();"]:
                message = sql(command, role, database, expect_error=True)
                assert "permission denied" in message
        check("visitors remain blocked from both private schemas, writes and helpers", True)
        for name, args in [("reviews_list", "10,0"), ("draw_result_get", "null")]:
            assert "permission denied" in sql(f"select public.{name}({args});", "rename_no_grants", database, expect_error=True)
        check("PUBLIC still has no execute access to app RPCs", True)
        check("all data RPCs retain definer privilege and fixed search path", sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('reviews_list','review_get','review_create','review_update','review_delete','draw_result_get') and prosecdef and 'search_path=pg_catalog'=any(proconfig);", database=database) == "6")

        for name, statements in [
            ("rename_partial", "alter schema draws_private rename to aalotto_number;"),
            ("rename_manual", "alter schema draws_private rename to aalotto_number; alter table aalotto_number.draws rename to lotto; alter schema reviews_private rename to aareview_private;"),
        ]:
            old_database(name)
            sql(statements, database=name)
            sql(migration, database=name)
            assert call("draw_result_get", 1247, database=name)["draw_no"] == 1247
            post = call("review_create", "재연결", "제목", "내용", "0381", database=name)
            assert "id" in post and call("review_delete", post["id"], "0381", database=name) == {"deleted": True}
        check("partial and complete manual renames repair broken function references safely", True)

        database = old_database("rename_conflict")
        sql("create schema aalotto_number; create table aalotto_number.keep_me(id int primary key); insert into aalotto_number.keep_me values(1);", database=database)
        conflict_before = snapshot(database, "reviews_private", "draws_private.draws")
        sql(migration, database=database, expect_error=True)
        check("conflicting source/target schemas abort without modifying either dataset", snapshot(database, "reviews_private", "draws_private.draws") == conflict_before and sql("select id from aalotto_number.keep_me;", database=database) == "1" and sql("select to_regnamespace('aareview_private') is null;", database=database) == "t")
        database = old_database("rename_table_conflict")
        sql("alter schema draws_private rename to aalotto_number; create table aalotto_number.lotto(id int primary key); insert into aalotto_number.lotto values(9);", database=database)
        table_conflict_before = snapshot(database, "reviews_private", "aalotto_number.draws")
        sql(migration, database=database, expect_error=True)
        check("conflicting table names abort without replacing either table", snapshot(database, "reviews_private", "aalotto_number.draws") == table_conflict_before and sql("select id from aalotto_number.lotto;", database=database) == "9" and sql("select to_regnamespace('aareview_private') is null;", database=database) == "t")
        database = old_database("rename_missing")
        sql("alter table draws_private.draws rename to unexpected_name;", database=database)
        missing_before = snapshot(database, "reviews_private", "draws_private.unexpected_name")
        sql(migration, database=database, expect_error=True)
        check("missing expected table aborts and rolls back every earlier rename", snapshot(database, "reviews_private", "draws_private.unexpected_name") == missing_before and sql("select to_regnamespace('draws_private') is not null and to_regnamespace('reviews_private') is not null and to_regnamespace('aalotto_number') is null and to_regnamespace('aareview_private') is null;", database=database) == "t")

        database = old_database("rename_canonical_guard")
        guard_before = snapshot(database, "reviews_private", "draws_private.draws")
        sql((ROOT / "supabase/schema.sql").read_text(), database=database, expect_error=True)
        sql((ROOT / "supabase/draws.sql").read_text(), database=database, expect_error=True)
        check("new setup files refuse old live names instead of creating duplicate stores", snapshot(database, "reviews_private", "draws_private.draws") == guard_before and sql("select to_regnamespace('aalotto_number') is null and to_regnamespace('aareview_private') is null;", database=database) == "t")

        subprocess.run(["docker", "exec", CONTAINER, "createdb", "--username", "postgres", "rename_fresh"], check=True, capture_output=True)
        sql((ROOT / "supabase/schema.sql").read_text(), database="rename_fresh")
        sql((ROOT / "supabase/draws.sql").read_text(), database="rename_fresh")
        sql(migration, database="rename_fresh")
        check("fresh canonical schemas install under the new names and accept repeated rename", call("draw_result_get", 1247, database="rename_fresh")["draw_no"] == 1247 and "id" in call("review_create", "신규설치", "제목", "내용", "0123", database="rename_fresh"))
        print(json.dumps({"passed": PASSED, "failed": 0, "hostedWrites": 0}), flush=True)
    finally:
        if created:
            subprocess.run(["docker", "stop", CONTAINER], capture_output=True)


if __name__ == "__main__":
    main()
