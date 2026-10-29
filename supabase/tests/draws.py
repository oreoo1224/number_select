"""Actual PostgreSQL checks for owner-managed draw results; never contacts Supabase.

Creates a disposable PostgreSQL 17 Docker container with no network or host port.
All fabricated draw rows in these tests exist only inside that local container.
"""

import json
import os
from pathlib import Path
import subprocess
import time


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "draws.sql"
CONTAINER = f"number-select-draws-validation-{os.getpid()}"
PASSED = 0


def sql(command, role=None, error=None):
    if role:
        command = f"set role {role};\n" + command
    result = subprocess.run(
        ["docker", "exec", "--interactive", CONTAINER, "psql", "--username", "postgres",
         "--dbname", "postgres", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet"],
        input=command, text=True, capture_output=True,
    )
    if error:
        assert result.returncode != 0 and error in result.stderr, result.stderr
        return None
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def literal(value):
    return "null" if value is None else "'" + str(value).replace("'", "''") + "'"


def get(round_number=None, role="anon"):
    value = sql(f"select public.draw_result_get({literal(round_number)});", role)
    return json.loads(value) if value else None


def check(label, condition):
    global PASSED
    assert condition, label
    PASSED += 1
    print("PASS", label, flush=True)


def insert(draw_no, date="(statement_timestamp() at time zone 'Asia/Seoul')::date", numbers=(1, 2, 3, 4, 5, 6), bonus=7, error=None):
    values = ",".join(literal(value) for value in (draw_no, *numbers, bonus))
    # The date expression is a fixed local-test SQL expression, never user input.
    return sql(
        "insert into aalotto_number.lotto(draw_no,n1,n2,n3,n4,n5,n6,bonus_number,draw_date) "
        f"values ({values},{date});", error=error,
    )


def main():
    created = False
    try:
        subprocess.run(
            ["docker", "run", "--detach", "--rm", "--pull", "never", "--name", CONTAINER,
             "--network", "none", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"],
            check=True, capture_output=True, text=True,
        )
        created = True
        for _ in range(75):
            result = subprocess.run(
                ["docker", "exec", CONTAINER, "pg_isready", "--host", "127.0.0.1", "--username", "postgres"],
                capture_output=True,
            )
            if result.returncode == 0:
                break
            time.sleep(.2)
        else:
            raise AssertionError("Isolated PostgreSQL did not become ready")
        config = json.loads(subprocess.check_output(["docker", "inspect", CONTAINER], text=True))[0]
        assert config["Config"]["Image"] == "postgres:17-alpine"
        assert config["HostConfig"]["NetworkMode"] == "none"
        assert not config["HostConfig"].get("PortBindings")
        check("validation runs only in an isolated container without exposed ports", True)

        sql("create role anon nologin; create role authenticated nologin; create role service_role nologin; create role draws_no_grants nologin;")
        # Simulate broad platform defaults so the migration must narrow grants.
        sql("alter default privileges grant all on tables to anon,authenticated,service_role; alter default privileges grant execute on functions to anon,authenticated,service_role;")
        sql((ROOT / "schema.sql").read_text())
        review = json.loads(sql("select public.review_create('로컬점검','후기 보존 점검','관리자 당첨번호 설정과 독립적인 테스트 후기','0123');", "anon"))
        assert "id" in review
        review_before = sql("select jsonb_agg(to_jsonb(p) order by id) from aareview_private.posts p;")
        sql(MIGRATION.read_text())

        known = get(1247)
        check("known existing result is readable through the public RPC", known is not None and known["draw_no"] == 1247 and known["draw_date"] == "2026-10-24" and known["winning_numbers"] == [8, 14, 21, 22, 42, 45] and known["bonus_number"] == 24)
        check("default/latest result and authenticated read use the same safe shape", get() == known and get(1247, "authenticated") == known and set(known) == {"draw_no", "draw_date", "winning_numbers", "bonus_number", "updated_at"})
        check("unregistered and invalid round references return null", get(9999999) is None and get(-1) is None)

        for role in ["anon", "authenticated", "service_role"]:
            for command in [
                "select * from aalotto_number.lotto;",
                "insert into aalotto_number.lotto(draw_no,draw_date,n1,n2,n3,n4,n5,n6,bonus_number) values(2000,current_date,1,2,3,4,5,6,7);",
                "update aalotto_number.lotto set n1=1 where draw_no=1247;",
                "delete from aalotto_number.lotto where draw_no=1247;",
                "select aalotto_number.touch_updated_at();",
            ]:
                sql(command, role, error="permission denied")
        check("anonymous/authenticated/service roles cannot read or mutate private draws or invoke helpers", True)
        sql("select public.draw_result_get(null);", "draws_no_grants", error="permission denied")
        sql("select public.draw_result_get(null);", "service_role", error="permission denied")
        check("PUBLIC default and service-role RPC execute grants are removed", True)
        check("private table RLS is enabled without public policies", sql("select relrowsecurity from pg_class where oid='aalotto_number.lotto'::regclass;") == "t" and sql("select count(*) from pg_policy where polrelid='aalotto_number.lotto'::regclass;") == "0")
        check("read-only RPC uses a fixed definer search path", sql("select prosecdef and 'search_path=pg_catalog'=any(proconfig) from pg_proc where oid='public.draw_result_get(integer)'::regprocedure;") == "t")

        for values in [
            {"draw_no": 0}, {"draw_no": -1},
            {"draw_no": 2000, "numbers": (0, 2, 3, 4, 5, 6)},
            {"draw_no": 2000, "numbers": (1, 2, 3, 4, 5, 46)},
            {"draw_no": 2000, "numbers": (1, 2, 3, 4, 5, 5)},
            {"draw_no": 2000, "numbers": (2, 1, 3, 4, 5, 6)},
            {"draw_no": 2000, "bonus": 1}, {"draw_no": 2000, "bonus": 0},
            {"draw_no": 2000, "bonus": 46},
        ]:
            insert(**values, error="violates check constraint")
        insert(2000, date="null", error="violates not-null constraint")
        insert(2000, numbers=(None, 2, 3, 4, 5, 6), error="violates not-null constraint")
        check("database validates positive rounds, six sorted distinct numbers, bonus and required fields", True)

        insert(1246, date="date '2026-10-17'")
        check("registered past rounds remain individually readable", get(1246)["winning_numbers"] == [1, 2, 3, 4, 5, 6])
        insert(1248)
        check("owner insertion immediately changes the public latest result", get()["draw_no"] == 1248)
        insert(1249, date="(statement_timestamp() at time zone 'Asia/Seoul')::date + 7")
        check("future KST-date entries are hidden from latest and exact-round queries", get()["draw_no"] == 1248 and get(1249) is None)
        check("RPC date comparison explicitly uses the KST calendar", "Asia/Seoul" in sql("select pg_get_functiondef('public.draw_result_get(integer)'::regprocedure);"))

        before = sql("select jsonb_build_object('created_at',created_at,'updated_at',updated_at) from aalotto_number.lotto where draw_no=1248;")
        sql("update aalotto_number.lotto set n6=8,bonus_number=9,created_at='2000-01-01' where draw_no=1248;")
        after = sql("select jsonb_build_object('created_at',created_at,'updated_at',updated_at) from aalotto_number.lotto where draw_no=1248;")
        before, after = json.loads(before), json.loads(after)
        check("owner correction is visible and timestamp updates preserve original creation time", get(1248)["winning_numbers"] == [1, 2, 3, 4, 5, 8] and get(1248)["bonus_number"] == 9 and after["created_at"] == before["created_at"] and after["updated_at"] != before["updated_at"])

        sql("update aalotto_number.lotto set n1=7 where draw_no=1247;")
        stored_before = sql("select jsonb_agg(to_jsonb(d) order by draw_no) from aalotto_number.lotto d;")
        for _ in range(2):
            sql(MIGRATION.read_text())
            assert sql("select jsonb_agg(to_jsonb(d) order by draw_no) from aalotto_number.lotto d;") == stored_before
        check("repeated setup preserves every record and administrator correction including seed edits", get(1247)["winning_numbers"][0] == 7)
        check("draw setup never changes existing review posts or password hashes", sql("select jsonb_agg(to_jsonb(p) order by id) from aareview_private.posts p;") == review_before)
        check("existing anonymous review API remains operational", json.loads(sql(f"select public.review_get({literal(review['id'])});", "anon"))["id"] == review["id"])

        sql("delete from aalotto_number.lotto where draw_no=1248;")
        check("owner removal immediately changes public latest without exposing future entry", get(1248) is None and get()["draw_no"] == 1247)
        sql("delete from aalotto_number.lotto;")
        check("empty storage returns null for latest and exact round", get() is None and get(1247) is None)
        print(json.dumps({"passed": PASSED, "failed": 0, "hostedWrites": 0}), flush=True)
    finally:
        if created:
            subprocess.run(["docker", "stop", CONTAINER], capture_output=True)


if __name__ == "__main__":
    main()
