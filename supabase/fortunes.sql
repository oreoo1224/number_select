-- Date-scoped, owner-managed fortunes for luckzip.com.
-- Install in Supabase SQL Editor. Import CSV through the owner's Table Editor.
-- Re-running this file preserves every stored fortune.
begin;

create schema if not exists fortunes_private;
revoke all on schema fortunes_private from public, anon, authenticated, service_role;

create table if not exists fortunes_private.daily_fortunes (
  fortune_date date not null,
  zodiac text not null,
  birth_year integer not null check (birth_year between 1948 and 2007),
  fortune_text text not null,
  primary key (fortune_date, birth_year),
  constraint fortunes_zodiac_matches_year check (
    zodiac = (array['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'])[(birth_year - 4) % 12 + 1]
  ),
  constraint fortunes_text_length check (pg_catalog.char_length(fortune_text) between 1 and 300),
  constraint fortunes_text_plain_line check (
    fortune_text = pg_catalog.btrim(fortune_text)
    and fortune_text !~ '[[:cntrl:]]'
  )
);

alter table fortunes_private.daily_fortunes enable row level security;
revoke all on all tables in schema fortunes_private from public, anon, authenticated, service_role;

-- There is deliberately no date parameter or public write function.
-- The private table must never be added to the Data API's exposed schemas.
create or replace function public.fortunes_today(p_zodiac text default null)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog
as $body$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Seoul')::date;
  v_next_update timestamptz := (v_today + 1)::timestamp at time zone 'Asia/Seoul';
  v_items jsonb;
begin
  if p_zodiac is not null and p_zodiac not in
    ('쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지') then
    raise exception 'Choose one of the twelve zodiac signs.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config(
    'response.headers',
    '[{"Cache-Control":"no-store, max-age=0"}]',
    true
  );

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'zodiac', fortune.zodiac,
      'birth_year', fortune.birth_year,
      'fortune_text', fortune.fortune_text
    ) order by (fortune.birth_year - 4) % 12, fortune.birth_year
  ), '[]'::jsonb)
  into v_items
  from fortunes_private.daily_fortunes as fortune
  where fortune.fortune_date = v_today
    and (p_zodiac is null or fortune.zodiac = p_zodiac);

  return pg_catalog.jsonb_build_object(
    'date', v_today,
    'server_time', pg_catalog.to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'next_update_at', pg_catalog.to_char(v_next_update at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'items', v_items
  );
end;
$body$;

revoke all on all functions in schema fortunes_private from public, anon, authenticated, service_role;
revoke all on function public.fortunes_today(text) from public, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated;
grant execute on function public.fortunes_today(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
