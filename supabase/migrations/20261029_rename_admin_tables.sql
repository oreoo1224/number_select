-- Rename administrator-facing schemas/tables without copying or deleting data.
-- Run the complete file in Supabase SQL Editor. Safe to run again.
-- Public RPC names, arguments and JSON fields used by the website stay the same.
begin;
set local search_path = pg_catalog;

do $rename_admin_objects$
declare
  draw_schema text;
  review_schema text;
  signature text;
  function_oid oid;
  definition text;
begin
  -- Do not guess which copy owns the real data when both names already exist.
  if pg_catalog.to_regnamespace('draws_private') is not null
     and pg_catalog.to_regnamespace('aalotto_number') is not null then
    raise exception 'Both draws_private and aalotto_number exist. No changes were applied; resolve the conflicting schema names before rerunning.';
  end if;
  if pg_catalog.to_regnamespace('reviews_private') is not null
     and pg_catalog.to_regnamespace('aareview_private') is not null then
    raise exception 'Both reviews_private and aareview_private exist. No changes were applied; resolve the conflicting schema names before rerunning.';
  end if;

  draw_schema := case
    when pg_catalog.to_regnamespace('draws_private') is not null then 'draws_private'
    when pg_catalog.to_regnamespace('aalotto_number') is not null then 'aalotto_number'
    else null
  end;
  review_schema := case
    when pg_catalog.to_regnamespace('reviews_private') is not null then 'reviews_private'
    when pg_catalog.to_regnamespace('aareview_private') is not null then 'aareview_private'
    else null
  end;
  if draw_schema is null or review_schema is null then
    raise exception 'The existing draw and review stores are required. No data was created or renamed.';
  end if;
  if pg_catalog.to_regclass(pg_catalog.format('%I.draws', draw_schema)) is not null
     and pg_catalog.to_regclass(pg_catalog.format('%I.lotto', draw_schema)) is not null then
    raise exception 'Both draws and lotto exist in the draw schema. No changes were applied; resolve the conflicting table names before rerunning.';
  end if;
  if pg_catalog.to_regclass(pg_catalog.format('%I.draws', draw_schema)) is null
     and pg_catalog.to_regclass(pg_catalog.format('%I.lotto', draw_schema)) is null then
    raise exception 'The existing draw results table is missing. No data was created or renamed.';
  end if;
  if pg_catalog.to_regclass(pg_catalog.format('%I.posts', review_schema)) is null
     or pg_catalog.to_regclass(pg_catalog.format('%I.request_limits', review_schema)) is null then
    raise exception 'The existing review tables are missing. No data was created or renamed.';
  end if;

  if draw_schema = 'draws_private' then
    alter schema draws_private rename to aalotto_number;
  end if;
  if pg_catalog.to_regclass('aalotto_number.draws') is not null then
    alter table aalotto_number.draws rename to lotto;
  end if;
  if review_schema = 'reviews_private' then
    alter schema reviews_private rename to aareview_private;
  end if;

  -- PostgreSQL renames the objects/types and preserves their identities, grants,
  -- RLS, indexes and triggers. SQL/PLpgSQL string bodies still contain the old
  -- qualified names, so recreate exactly the known application functions.
  -- CREATE OR REPLACE preserves their OIDs, ownership and existing EXECUTE ACLs.
  for signature in
    select required.signature
    from (values
      ('aareview_private.hash_password(text)'),
      ('aareview_private.password_matches(text,text)'),
      ('aareview_private.error(text,text)'),
      ('aareview_private.public_post(aareview_private.posts)'),
      ('aareview_private.valid_fields(text,text,text)'),
      ('aareview_private.valid_new_password(text)'),
      ('aareview_private.valid_password(text)'),
      ('aareview_private.consume_limit(text,integer,interval)'),
      ('aareview_private.allow_write()'),
      ('aalotto_number.touch_updated_at()'),
      ('public.reviews_list(integer,integer)'),
      ('public.review_get(uuid)'),
      ('public.review_create(text,text,text,text)'),
      ('public.review_update(uuid,text,text,text,text)'),
      ('public.review_delete(uuid,text)'),
      ('public.reviews_config()'),
      ('public.draw_result_get(integer)')
    ) as required(signature)
  loop
    function_oid := pg_catalog.to_regprocedure(signature)::oid;
    if function_oid is null then
      raise exception 'Required application function % is missing. All changes were rolled back.', signature;
    end if;
    definition := pg_catalog.pg_get_functiondef(function_oid);
    -- Match complete qualified identifiers, including quoted spellings. These
    -- replacements affect only function definitions, never stored visitor data.
    definition := pg_catalog.regexp_replace(definition,
      $pattern$(\mreviews_private|"reviews_private")\.$pattern$,
      'aareview_private.', 'g');
    definition := pg_catalog.regexp_replace(definition,
      $pattern$(\mdraws_private|"draws_private")\.$pattern$,
      'aalotto_number.', 'g');
    definition := pg_catalog.regexp_replace(definition,
      $pattern$(\maalotto_number|"aalotto_number")\.(\mdraws\M|"draws")$pattern$,
      'aalotto_number.lotto', 'g');
    execute definition;
  end loop;
end;
$rename_admin_objects$;

notify pgrst, 'reload schema';
commit;
