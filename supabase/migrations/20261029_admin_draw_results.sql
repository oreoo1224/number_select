-- Owner-managed winning results for luckzip.com.
-- Run once in the project's Supabase SQL Editor; safe to run again.
-- Only the project owner/admin edits this private table through the dashboard.
-- Public website visitors receive a read-only, explicitly whitelisted RPC.
begin;

create schema if not exists draws_private;
revoke all on schema draws_private from public, anon, authenticated, service_role;

create table if not exists draws_private.draws (
  draw_no integer primary key check (draw_no > 0),
  draw_date date not null,
  n1 integer not null check (n1 between 1 and 45),
  n2 integer not null check (n2 between 1 and 45),
  n3 integer not null check (n3 between 1 and 45),
  n4 integer not null check (n4 between 1 and 45),
  n5 integer not null check (n5 between 1 and 45),
  n6 integer not null check (n6 between 1 and 45),
  bonus_number integer not null check (bonus_number between 1 and 45),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint draws_numbers_sorted_unique check (n1 < n2 and n2 < n3 and n3 < n4 and n4 < n5 and n5 < n6),
  constraint draws_bonus_distinct check (bonus_number not in (n1, n2, n3, n4, n5, n6))
);

alter table draws_private.draws enable row level security;
revoke all on all tables in schema draws_private from public, anon, authenticated, service_role;

create or replace function draws_private.touch_updated_at()
returns trigger language plpgsql
set search_path = pg_catalog
as $body$
begin
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$body$;

create or replace trigger draws_touch_updated_at
before update on draws_private.draws
for each row execute function draws_private.touch_updated_at();

create or replace function public.draw_result_get(p_draw_no integer default null)
returns jsonb language sql stable security definer
set search_path = pg_catalog
as $body$
  select pg_catalog.jsonb_build_object(
    'draw_no', draw.draw_no,
    'draw_date', draw.draw_date,
    'winning_numbers', pg_catalog.jsonb_build_array(draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6),
    'bonus_number', draw.bonus_number,
    'updated_at', draw.updated_at
  )
  from draws_private.draws as draw
  where (p_draw_no is null or draw.draw_no = p_draw_no)
    and draw.draw_date <= (pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date
  order by draw.draw_no desc
  limit 1
$body$;

-- Existing stored reference result, not an automatic import or a future draw.
-- Re-running setup never overwrites an administrator's correction to this row.
insert into draws_private.draws (draw_no, draw_date, n1, n2, n3, n4, n5, n6, bonus_number)
values (1247, date '2026-10-24', 8, 14, 21, 22, 42, 45, 24)
on conflict (draw_no) do nothing;

revoke all on all functions in schema draws_private from public, anon, authenticated, service_role;
revoke all on function public.draw_result_get(integer) from public, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated;
grant execute on function public.draw_result_get(integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
