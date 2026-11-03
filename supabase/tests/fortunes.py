"""Exercise today's-only fortunes in disposable PostgreSQL; never calls Supabase.

Requires Docker and the cached postgres:17-alpine image. No container network or
host port is enabled. Synthetic fortunes and clock overrides exist only in the
isolated test database, and each clock override is rolled back immediately.
"""

import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import time


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "fortunes.sql"
CONTAINER = f"number-select-fortunes-validation-{os.getpid()}"
SIGNS = ("쥐", "소", "호랑이", "토끼", "용", "뱀", "말", "양", "원숭이", "닭", "개", "돼지")
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


def check(label, condition):
    global PASSED
    assert condition, label
    PASSED += 1
    print("PASS", label, flush=True)


def call(sign=None, role="anon", prefix=""):
    return json.loads(sql(prefix + f"select public.fortunes_today({literal(sign)});", role))


def timestamps(payload):
    return (
        dt.datetime.fromisoformat(payload["server_time"].replace("Z", "+00:00")),
        dt.datetime.fromisoformat(payload["next_update_at"].replace("Z", "+00:00")),
    )


def insert(date_expression, year=1948, sign="쥐", text="로컬 검증용 운세로 실제 서비스에 공개되지 않는 문장입니다.", error=None):
    return sql(
        "insert into fortunes_private.daily_fortunes(fortune_date,zodiac,birth_year,fortune_text) "
        f"values ({date_expression},{literal(sign)},{literal(year)},{literal(text)});", error=error,
    )


def frozen_call(definition, moment, sign=None):
    # Execute the real RPC body with its single clock read replaced. The DDL and
    # data remain inside this local container and are rolled back on every call.
    needle = "pg_catalog.clock_timestamp()"
    assert definition.count(needle) == 1
    frozen = definition.replace(needle, literal(moment) + "::timestamptz")
    command = (
        "begin;\n" + frozen + ";\nset local role anon;\n"
        + f"select public.fortunes_today({literal(sign)});\nrollback;"
    )
    return json.loads(sql(command))


def main():
    migration = MIGRATION.read_text()
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
        check("local validation has no network or exposed port", config["Config"]["Image"] == "postgres:17-alpine" and config["HostConfig"]["NetworkMode"] == "none" and not config["HostConfig"].get("PortBindings"))

        sql("create role anon nologin; create role authenticated nologin; create role service_role nologin; create role fortunes_no_grants nologin;")
        sql("alter default privileges grant all on tables to anon,authenticated,service_role; alter default privileges grant execute on functions to anon,authenticated,service_role;")
        sql((ROOT / "schema.sql").read_text())
        sql((ROOT / "draws.sql").read_text())
        post = json.loads(sql("select public.review_create('로컬 점검','보존 확인','운세 설치와 독립적으로 보존할 로컬 테스트 후기입니다.','0123');", "anon"))
        old_posts = sql("select jsonb_agg(to_jsonb(p) order by id) from aareview_private.posts p;")
        old_limits = sql("select jsonb_agg(to_jsonb(p) order by bucket) from aareview_private.request_limits p;")
        old_draws = sql("select jsonb_agg(to_jsonb(p) order by draw_no) from aalotto_number.lotto p;")
        sql(migration)
        check("install does not seed or publish example fortunes", sql("select count(*) from fortunes_private.daily_fortunes;") == "0")

        empty = call()
        server_now, next_update = timestamps(empty)
        kst = dt.timezone(dt.timedelta(hours=9))
        check("empty today returns an explicit empty envelope", set(empty) == {"date", "server_time", "next_update_at", "items"} and empty["items"] == [] and call("쥐")["items"] == [])
        check("date is derived from server KST and next update is next KST midnight", empty["date"] == server_now.astimezone(kst).date().isoformat() and next_update == dt.datetime.combine(server_now.astimezone(kst).date() + dt.timedelta(days=1), dt.time(), tzinfo=kst) and 0 < (next_update - server_now).total_seconds() <= 86400)

        sql("""
            insert into fortunes_private.daily_fortunes(fortune_date,zodiac,birth_year,fortune_text)
            select d, (array['쥐','소','호랑이','토끼','용','뱀','말','양','원숭이','닭','개','돼지'])[(y-4)%12+1],
                   y, d::text || ' ' || y::text || ' 로컬 검증용 운세입니다.'
            from generate_series(1948,2007) as years(y)
            cross join (select (clock_timestamp() at time zone 'Asia/Seoul')::date + n as d
                        from generate_series(-1,1) as offsets(n)) as dates;
        """)
        today = call()
        expected_years = set(range(1948, 2008))
        check("anonymous RPC returns exactly the 60 present-day birth years", len(today["items"]) == 60 and {item["birth_year"] for item in today["items"]} == expected_years)
        check("returned item fields are limited to display data", all(set(item) == {"zodiac", "birth_year", "fortune_text"} for item in today["items"]))
        check("past and future rows are stored privately and never appear in today's response", sql("select count(*) from fortunes_private.daily_fortunes;") == "180" and all(item["fortune_text"].startswith(today["date"] + " ") for item in today["items"]))
        other = call(role="authenticated")
        check("authenticated and anonymous reads have the same date and items", other["date"] == today["date"] and other["items"] == today["items"])
        for index, sign in enumerate(SIGNS):
            items = call(sign)["items"]
            years = list(range(1948 + index, 2008, 12))
            assert len(items) == 5 and [item["birth_year"] for item in items] == years and all(item["zodiac"] == sign for item in items)
        check("each of twelve animal selections returns its five ordered birth years", True)

        for sign in ["", "쥐띠", " 쥐", "쥐 ", "2026-11-04", "쥐' OR TRUE --", "용; delete from fortunes_private.daily_fortunes"]:
            sql(f"select public.fortunes_today({literal(sign)});", "anon", error="Choose one of the twelve zodiac signs")
        check("invalid signs and SQL-looking input are rejected without mutating data", sql("select count(*) from fortunes_private.daily_fortunes;") == "180")

        for role in ["anon", "authenticated", "service_role"]:
            for statement in [
                "select * from fortunes_private.daily_fortunes;",
                "insert into fortunes_private.daily_fortunes values (current_date,'쥐',1948,'권한 없는 글');",
                "update fortunes_private.daily_fortunes set fortune_text='권한 없는 수정';",
                "delete from fortunes_private.daily_fortunes;",
                "truncate fortunes_private.daily_fortunes;",
            ]:
                sql(statement, role, error="permission denied")
        check("visitors and service-role defaults cannot read or mutate the private store directly", True)
        for role in ["service_role", "fortunes_no_grants"]:
            sql("select public.fortunes_today(null);", role, error="permission denied")
        check("only explicitly granted visitor roles can execute the read RPC", True)
        check("private RLS is enabled with no visitor policies", sql("select relrowsecurity from pg_class where oid='fortunes_private.daily_fortunes'::regclass;") == "t" and sql("select count(*) from pg_policy where polrelid='fortunes_private.daily_fortunes'::regclass;") == "0")
        check("RPC has a fixed definer search path and only one text argument", sql("select prosecdef and 'search_path=pg_catalog'=any(proconfig) and pronargs=1 and proargnames=array['p_zodiac']::text[] and proargtypes='25'::oidvector from pg_proc where oid='public.fortunes_today(text)'::regprocedure;") == "t")
        check("no public fortune date selector or write function is installed", sql("select count(*) from pg_proc p where pronamespace='public'::regnamespace and proname like '%fortune%';") == "1")
        sql("select public.fortunes_today('쥐',date '2026-11-04');", "anon", error="does not exist")
        check("adding a date argument cannot retrieve a different day", True)

        changed_zone = call(prefix="set timezone='Pacific/Honolulu';")
        check("session timezone does not change the KST date or selected fortunes", changed_zone["date"] == today["date"] and changed_zone["items"] == today["items"])
        forged = call(prefix="set request.headers='{\"date\":\"2000-01-01\",\"x-fortune-date\":\"2099-12-31\"}'; set request.jwt.claims='{\"fortune_date\":\"2000-01-01\"}';")
        check("caller-controlled headers and claims cannot select another date", forged["date"] == today["date"] and forged["items"] == today["items"])
        headers = json.loads(sql("begin; set local role anon; select public.fortunes_today(null) is not null; select current_setting('response.headers'); rollback;").splitlines()[-1])
        check("RPC tells PostgREST and intermediaries not to cache date-scoped responses", any(key.lower() == "cache-control" and "no-store" in value and "max-age=0" in value for item in headers for key, value in item.items()))

        # Constraints are exercised with otherwise-unused dates so failures cannot
        # be confused with the existing (date,birth-year) primary keys.
        date = "date '2099-01-01'"
        for kwargs, message in [
            ({"year": 1947, "sign": "돼지"}, "violates check constraint"),
            ({"year": 2008, "sign": "쥐"}, "violates check constraint"),
            ({"year": 1948, "sign": "소"}, "violates check constraint"),
            ({"sign": "없는 띠"}, "violates check constraint"),
            ({"text": ""}, "violates check constraint"),
            ({"text": "가" * 301}, "violates check constraint"),
            ({"text": " 앞 공백"}, "violates check constraint"),
            ({"text": "뒤 공백 "}, "violates check constraint"),
            ({"text": "줄바꿈\n내용"}, "violates check constraint"),
            ({"text": "탭\t내용"}, "violates check constraint"),
            ({"text": None}, "violates not-null constraint"),
            ({"year": None}, "violates not-null constraint"),
            ({"sign": None}, "violates not-null constraint"),
        ]:
            insert(date, **kwargs, error=message)
        insert("null", error="violates not-null constraint")
        check("database rejects mismatched cohorts, invalid text and missing required fields", True)
        insert(date)
        insert(date, error="duplicate key value violates unique constraint")
        check("one birth year cannot have multiple fortunes on the same date", True)
        sql("delete from fortunes_private.daily_fortunes where fortune_date=date '2099-01-01';")

        definition = sql("select pg_get_functiondef('public.fortunes_today(text)'::regprocedure);")
        sql("""
            insert into fortunes_private.daily_fortunes values
            ('2040-01-31','쥐',1948,'월말의 로컬 검증용 운세입니다.'),
            ('2040-02-01','쥐',1948,'새달의 로컬 검증용 운세입니다.'),
            ('2040-02-28','쥐',1948,'윤일 전날의 로컬 검증용 운세입니다.'),
            ('2040-02-29','쥐',1948,'윤일의 로컬 검증용 운세입니다.'),
            ('2040-12-31','쥐',1948,'연말의 로컬 검증용 운세입니다.'),
            ('2041-01-01','쥐',1948,'새해의 로컬 검증용 운세입니다.');
        """)
        for before_time, after_time, before_date, after_date in [
            ("2040-01-31T14:59:59.999Z", "2040-01-31T15:00:00.000Z", "2040-01-31", "2040-02-01"),
            ("2040-02-28T14:59:59.999Z", "2040-02-28T15:00:00.000Z", "2040-02-28", "2040-02-29"),
            ("2040-12-31T14:59:59.999Z", "2040-12-31T15:00:00.000Z", "2040-12-31", "2041-01-01"),
        ]:
            before = frozen_call(definition, before_time, "쥐")
            after = frozen_call(definition, after_time, "쥐")
            assert before["date"] == before_date and after["date"] == after_date
            assert len(before["items"]) == len(after["items"]) == 1
            assert before["items"][0]["fortune_text"] != after["items"][0]["fortune_text"]
            _, end_before = timestamps(before)
            now_after, end_after = timestamps(after)
            assert end_before == now_after and (end_after - now_after).total_seconds() == 86400
        check("real RPC body switches only at KST midnight across month, leap-day and year boundaries", sql("select pg_get_functiondef('public.fortunes_today(text)'::regprocedure);") == definition)

        sql("update fortunes_private.daily_fortunes set fortune_text='관리자가 고친 로컬 검증용 운세입니다.' where fortune_date=(clock_timestamp() at time zone 'Asia/Seoul')::date and birth_year=1948;")
        check("owner corrections are immediately returned without a website deployment", call("쥐")["items"][0]["fortune_text"] == "관리자가 고친 로컬 검증용 운세입니다.")
        stored = sql("select jsonb_agg(to_jsonb(f) order by fortune_date,birth_year) from fortunes_private.daily_fortunes f;")
        for _ in range(2):
            sql(migration)
            assert sql("select jsonb_agg(to_jsonb(f) order by fortune_date,birth_year) from fortunes_private.daily_fortunes f;") == stored
        check("repeated setup preserves every date and administrator correction", call("쥐")["items"][0]["fortune_text"] == "관리자가 고친 로컬 검증용 운세입니다.")
        check("repeated setup preserves restrictive schema and function grants", sql("select has_schema_privilege('anon','fortunes_private','usage') or has_table_privilege('anon','fortunes_private.daily_fortunes','select') or has_function_privilege('service_role','public.fortunes_today(text)','execute');") == "f")
        check("fortune install and queries preserve existing reviews, hashes, limits and draws", sql("select jsonb_agg(to_jsonb(p) order by id) from aareview_private.posts p;") == old_posts and sql("select jsonb_agg(to_jsonb(p) order by bucket) from aareview_private.request_limits p;") == old_limits and sql("select jsonb_agg(to_jsonb(p) order by draw_no) from aalotto_number.lotto p;") == old_draws)
        check("existing public review and draw APIs still operate", json.loads(sql(f"select public.review_get({literal(post['id'])});", "anon"))["id"] == post["id"] and json.loads(sql("select public.draw_result_get(1247);", "anon"))["draw_no"] == 1247)
        print(json.dumps({"passed": PASSED, "failed": 0, "hostedWrites": 0}), flush=True)
    finally:
        if created:
            subprocess.run(["docker", "stop", CONTAINER], capture_output=True)


if __name__ == "__main__":
    main()
