-- Anonymous review board for luckzip.com.
-- Run this complete file in the SQL Editor of the project's Supabase dashboard.
-- Re-running it updates functions/permissions without deleting existing posts.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists reviews_private;

revoke all on schema reviews_private from public, anon, authenticated;

create table if not exists reviews_private.posts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  nickname text not null check (nickname = pg_catalog.btrim(nickname) and pg_catalog.char_length(nickname) between 1 and 20),
  title text not null check (title = pg_catalog.btrim(title) and pg_catalog.char_length(title) between 1 and 80),
  content text not null check (content = pg_catalog.btrim(content) and pg_catalog.char_length(content) between 1 and 4000),
  password_hash text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);
create index if not exists reviews_posts_created_idx
  on reviews_private.posts (created_at desc, id desc);

create table if not exists reviews_private.request_limits (
  bucket text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  updated_at timestamptz not null
);

alter table reviews_private.posts enable row level security;
alter table reviews_private.request_limits enable row level security;
revoke all on all tables in schema reviews_private from public, anon, authenticated;

-- Do not move an existing pgcrypto installation in a shared Supabase project.
-- Resolve its actual namespace once and fully qualify every cryptographic call.
do $install_crypto$
declare
  crypto_schema text;
begin
  select ns.nspname into strict crypto_schema
  from pg_catalog.pg_extension ex
  join pg_catalog.pg_namespace ns on ns.oid = ex.extnamespace
  where ex.extname = 'pgcrypto';

  execute pg_catalog.format($definition$
    create or replace function reviews_private.hash_password(p_password text)
    returns text language sql volatile strict
    set search_path = pg_catalog
    as $body$
      select %1$I.crypt(
        pg_catalog.encode(%1$I.digest(pg_catalog.convert_to(p_password, 'UTF8'), 'sha256'), 'hex'),
        %1$I.gen_salt('bf', 12)
      )
    $body$
  $definition$, crypto_schema);

  execute pg_catalog.format($definition$
    create or replace function reviews_private.password_matches(p_password text, p_hash text)
    returns boolean language sql volatile strict
    set search_path = pg_catalog
    as $body$
      select p_hash = %1$I.crypt(
        pg_catalog.encode(%1$I.digest(pg_catalog.convert_to(p_password, 'UTF8'), 'sha256'), 'hex'),
        p_hash
      )
    $body$
  $definition$, crypto_schema);
end;
$install_crypto$;

create or replace function reviews_private.error(p_code text, p_message text)
returns jsonb language sql immutable
set search_path = pg_catalog
as $body$
  select pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object('code', p_code, 'message', p_message))
$body$;

create or replace function reviews_private.public_post(p_post reviews_private.posts)
returns jsonb language sql stable
set search_path = pg_catalog
as $body$
  select pg_catalog.jsonb_build_object(
    'id', (p_post).id,
    'nickname', (p_post).nickname,
    'title', (p_post).title,
    'content', (p_post).content,
    'created_at', (p_post).created_at,
    'updated_at', (p_post).updated_at
  )
$body$;

create or replace function reviews_private.valid_fields(p_nickname text, p_title text, p_content text)
returns boolean language sql immutable
set search_path = pg_catalog
as $body$
  select coalesce(
    pg_catalog.char_length(pg_catalog.btrim(p_nickname)) between 1 and 20
    and pg_catalog.char_length(pg_catalog.btrim(p_title)) between 1 and 80
    and pg_catalog.char_length(pg_catalog.btrim(p_content)) between 1 and 4000
    and p_nickname !~ E'[\n\r\t]'
    and p_title !~ E'[\n\r\t]',
    false
  )
$body$;

create or replace function reviews_private.valid_new_password(p_password text)
returns boolean language sql immutable
set search_path = pg_catalog
as $body$
  select coalesce(pg_catalog.octet_length(p_password) = 4 and p_password ~ '^[0-9]{4}$', false)
$body$;

-- Existing posts keep their original password. New posts use the strict PIN
-- helper above; authentication also accepts the previous 8-128 character rule.
create or replace function reviews_private.valid_password(p_password text)
returns boolean language sql immutable
set search_path = pg_catalog
as $body$
  select reviews_private.valid_new_password(p_password)
    or coalesce(pg_catalog.char_length(p_password) between 8 and 128, false)
$body$;

-- Atomic fixed-window counters. Business errors return JSON instead of raising
-- exceptions so failed password attempts and quota counters are committed.
create or replace function reviews_private.consume_limit(p_bucket text, p_max integer, p_window interval)
returns boolean language plpgsql volatile
set search_path = pg_catalog
as $body$
declare
  moment timestamptz := pg_catalog.clock_timestamp();
  current_attempts integer;
begin
  insert into reviews_private.request_limits (bucket, window_started_at, attempts, updated_at)
  values (p_bucket, moment, 1, moment)
  on conflict (bucket) do update set
    window_started_at = case
      when reviews_private.request_limits.window_started_at <= moment - p_window then moment
      else reviews_private.request_limits.window_started_at end,
    attempts = case
      when reviews_private.request_limits.window_started_at <= moment - p_window then 1
      else least(reviews_private.request_limits.attempts + 1, 1000000000) end,
    updated_at = moment
  returning attempts into current_attempts;
  return current_attempts <= p_max;
end;
$body$;

create or replace function reviews_private.allow_write()
returns boolean language plpgsql volatile
set search_path = pg_catalog
as $body$
begin
  delete from reviews_private.request_limits
  where updated_at < pg_catalog.clock_timestamp() - interval '1 day';
  return reviews_private.consume_limit('writes:global', 120, interval '1 minute');
end;
$body$;

create or replace function public.reviews_list(p_limit integer default 10, p_offset integer default 0)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog
as $body$
declare
  items jsonb;
  total bigint;
  take integer := greatest(1, least(coalesce(p_limit, 10), 20));
  skip integer := greatest(0, coalesce(p_offset, 0));
begin
  select pg_catalog.count(*) into total from reviews_private.posts;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', post.id,
    'nickname', post.nickname,
    'title', post.title,
    'excerpt', pg_catalog.left(post.content, 160),
    'created_at', post.created_at,
    'updated_at', post.updated_at
  ) order by post.created_at desc, post.id desc), '[]'::jsonb)
  into items
  from (
    select id, nickname, title, content, created_at, updated_at
    from reviews_private.posts
    order by created_at desc, id desc
    limit take offset skip
  ) post;
  return pg_catalog.jsonb_build_object('items', items, 'total', total);
end;
$body$;

create or replace function public.review_get(p_id uuid)
returns jsonb language sql stable security definer
set search_path = pg_catalog
as $body$
  select reviews_private.public_post(post)
  from reviews_private.posts post
  where post.id = p_id
$body$;

create or replace function public.review_create(p_nickname text, p_title text, p_content text, p_password text)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog
as $body$
declare
  post reviews_private.posts;
begin
  if not reviews_private.allow_write()
     or not reviews_private.consume_limit('creates:global', 12, interval '1 minute') then
    return reviews_private.error('REVIEW_RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  end if;
  if not reviews_private.valid_fields(p_nickname, p_title, p_content)
     or not reviews_private.valid_new_password(p_password) then
    return reviews_private.error('REVIEW_INVALID_INPUT', '닉네임 1~20자, 내용 1~4,000자, 숫자 4자리 작성 비밀번호를 확인해 주세요.');
  end if;
  insert into reviews_private.posts (nickname, title, content, password_hash)
  values (pg_catalog.btrim(p_nickname), pg_catalog.btrim(p_title), pg_catalog.btrim(p_content), reviews_private.hash_password(p_password))
  returning * into post;
  return reviews_private.public_post(post);
end;
$body$;

create or replace function public.review_update(p_id uuid, p_nickname text, p_title text, p_content text, p_password text)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog
as $body$
declare
  post reviews_private.posts;
begin
  if not reviews_private.allow_write() then
    return reviews_private.error('REVIEW_RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  end if;
  if p_id is null or not reviews_private.valid_fields(p_nickname, p_title, p_content)
     or not reviews_private.valid_password(p_password) then
    return reviews_private.error('REVIEW_INVALID_INPUT', '입력한 내용과 작성할 때 설정한 비밀번호를 확인해 주세요.');
  end if;
  select * into post from reviews_private.posts where id = p_id for update;
  if not found then
    return reviews_private.error('REVIEW_NOT_FOUND', '게시글을 찾을 수 없습니다.');
  end if;
  if not reviews_private.consume_limit('password:' || p_id::text, 8, interval '15 minutes') then
    return reviews_private.error('REVIEW_RATE_LIMITED', '비밀번호 확인 요청이 많습니다. 15분 후 다시 시도해 주세요.');
  end if;
  if not reviews_private.password_matches(p_password, post.password_hash) then
    return reviews_private.error('REVIEW_PASSWORD_INCORRECT', '비밀번호가 맞지 않습니다.');
  end if;
  delete from reviews_private.request_limits where bucket = 'password:' || p_id::text;
  update reviews_private.posts set
    nickname = pg_catalog.btrim(p_nickname),
    title = pg_catalog.btrim(p_title),
    content = pg_catalog.btrim(p_content),
    updated_at = pg_catalog.clock_timestamp()
  where id = p_id returning * into post;
  return reviews_private.public_post(post);
end;
$body$;

create or replace function public.review_delete(p_id uuid, p_password text)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog
as $body$
declare
  post reviews_private.posts;
begin
  if not reviews_private.allow_write() then
    return reviews_private.error('REVIEW_RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  end if;
  if p_id is null or not reviews_private.valid_password(p_password) then
    return reviews_private.error('REVIEW_INVALID_INPUT', '게시글과 작성할 때 설정한 비밀번호를 확인해 주세요.');
  end if;
  select * into post from reviews_private.posts where id = p_id for update;
  if not found then
    return reviews_private.error('REVIEW_NOT_FOUND', '게시글을 찾을 수 없습니다.');
  end if;
  if not reviews_private.consume_limit('password:' || p_id::text, 8, interval '15 minutes') then
    return reviews_private.error('REVIEW_RATE_LIMITED', '비밀번호 확인 요청이 많습니다. 15분 후 다시 시도해 주세요.');
  end if;
  if not reviews_private.password_matches(p_password, post.password_hash) then
    return reviews_private.error('REVIEW_PASSWORD_INCORRECT', '비밀번호가 맞지 않습니다.');
  end if;
  delete from reviews_private.posts where id = p_id;
  delete from reviews_private.request_limits where bucket = 'password:' || p_id::text;
  return pg_catalog.jsonb_build_object('deleted', true);
end;
$body$;

-- Public capability detection for clients waiting for the PIN migration.
create or replace function public.reviews_config()
returns jsonb language sql immutable
set search_path = pg_catalog
as $body$
  select pg_catalog.jsonb_build_object('password_digits', 4)
$body$;

-- Explicitly remove PUBLIC's default EXECUTE and Supabase's broad defaults.
revoke all on all functions in schema reviews_private from public, anon, authenticated;
revoke all on function public.reviews_list(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.review_get(uuid) from public, anon, authenticated, service_role;
revoke all on function public.review_create(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.review_update(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.review_delete(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.reviews_config() from public, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated;
grant execute on function public.reviews_list(integer, integer) to anon, authenticated;
grant execute on function public.review_get(uuid) to anon, authenticated;
grant execute on function public.review_create(text, text, text, text) to anon, authenticated;
grant execute on function public.review_update(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.review_delete(uuid, text) to anon, authenticated;
grant execute on function public.reviews_config() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
