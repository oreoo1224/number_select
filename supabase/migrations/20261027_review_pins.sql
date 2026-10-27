-- Upgrade an existing reviews schema: new posts use four ASCII digits.
-- Existing posts, password hashes and timestamps are not rewritten or removed.
-- Requires the previously installed supabase/schema.sql. Safe to run again.
begin;

create or replace function reviews_private.valid_new_password(p_password text)
returns boolean language sql immutable
set search_path = pg_catalog
as $body$
  select coalesce(pg_catalog.octet_length(p_password) = 4 and p_password ~ '^[0-9]{4}$', false)
$body$;

create or replace function reviews_private.valid_password(p_password text)
returns boolean language sql immutable
set search_path = pg_catalog
as $body$
  select reviews_private.valid_new_password(p_password)
    or coalesce(pg_catalog.char_length(p_password) between 8 and 128, false)
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

create or replace function public.reviews_config()
returns jsonb language sql immutable
set search_path = pg_catalog
as $body$
  select pg_catalog.jsonb_build_object('password_digits', 4)
$body$;

revoke all on function reviews_private.valid_new_password(text) from public, anon, authenticated;
revoke all on function reviews_private.valid_password(text) from public, anon, authenticated;
revoke all on function public.review_create(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.review_update(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.review_delete(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.reviews_config() from public, anon, authenticated, service_role;
grant execute on function public.review_create(text, text, text, text) to anon, authenticated;
grant execute on function public.review_update(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.review_delete(uuid, text) to anon, authenticated;
grant execute on function public.reviews_config() to anon, authenticated;
notify pgrst, 'reload schema';
commit;
