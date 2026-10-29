# Shared anonymous reviews

The website remains on GitHub Pages. Reviews are stored in the selected Supabase
Postgres database and read/written through five narrowly scoped RPC functions.
One additional read-only RPC reports the supported password format.
There is no visitor account signup. Each post has its own edit/delete password.

## Connect a real project

1. Create a Supabase project, or choose an existing project you control.
2. Open **SQL Editor** and run the complete contents of [schema.sql](schema.sql).
   Re-running it updates the functions and grants without deleting existing posts.
3. Keep `public` in the Data API's exposed schemas. Do **not** expose
   `aareview_private`, add direct anonymous table grants or create permissive RLS
   policies for those private tables.
4. Supply the website's configuration with the project's HTTPS URL and its
   **publishable key** (or legacy public **anon key**). These browser keys are
   intended to be public; database permissions in this migration protect writes
   and password hashes. Never put a `service_role` key, database password or
   dashboard access token in the repository or frontend.
5. Verify a post created from one browser/device appears in another. Verify a
   wrong password cannot modify/delete it and the correct password can.

Until the real project is connected and this SQL is applied, a static website
cannot retain shared visitor posts. A local-only browser fallback must not be
presented as shared persistence.

Existing installations using `reviews_private` / `draws_private.draws` must first
apply [the administrator-name migration](RENAME_ADMIN_TABLES.md). Current storage
names are `aareview_private.posts` and `aalotto_number.lotto`. Current setup files
refuse the old layout rather than creating parallel empty tables. Public RPC
names and browser settings do not change during the rename.

## API contract

Call `/rest/v1/rpc/<function>` using `POST`, JSON bodies and the project's public
key in the `apikey` request header. Do not send website cookies.

| Function | JSON parameters | Successful JSON result |
| --- | --- | --- |
| `reviews_list` | `p_limit` (default 10), `p_offset` (default 0) | `{ "items": [...], "total": 0 }` |
| `review_get` | `p_id` | Safe full post, or `null` if not found |
| `review_create` | `p_nickname`, `p_title`, `p_content`, `p_password` | Safe full post |
| `review_update` | `p_id`, `p_nickname`, `p_title`, `p_content`, `p_password` | Safe full post |
| `review_delete` | `p_id`, `p_password` | `{ "deleted": true }` |
| `reviews_config` | none | `{ "password_digits": 4 }` |

Full posts contain `id`, `nickname`, `title`, `content`, `created_at`, `updated_at`.
List entries contain the same metadata and a 160-character `excerpt`, without
the full `content`. Lists are newest-first, with UUID as the stable tie-breaker.
Limits are clamped to 1–20 items and offsets to zero or greater.

Validation requires a trimmed nickname of 1–20 characters and content of
1–4,000 characters. The title field is absent from the visitor form; the API
adapter derives the existing internal title (up to 80 characters) from the
leading content to preserve the database/RPC contract. Nickname/title cannot
contain line breaks or tabs. New passwords are exactly four ASCII digits,
including leading zeroes. Passwords are exact and are never trimmed or converted
to numbers. Existing posts with legacy 8–128 character passwords can still be
edited/deleted with their original passwords. Password changes and account-based
recovery are not part of this implementation.

## Upgrade an already connected project to four-digit PINs

This is a historical upgrade for the old `reviews_private` layout. After the
name migration, do not re-run this old migration; the current [schema.sql](schema.sql)
already includes four-digit PIN validation and uses `aareview_private` throughout.

Before the namespace rename, old installations used
[migrations/20261027_review_pins.sql](migrations/20261027_review_pins.sql) in
the project's SQL Editor to replace validation/RPC definitions without rewriting
posts or password hashes. Repeating that historical upgrade is supported only
while the old namespace still exists. Per-post attempt counters and write limits
are retained by the current setup and by the name migration.

The browser's public key cannot install SQL functions. Until the project owner
applies this upgrade and `reviews_config` reports `password_digits: 4`, the new
compose form disables submission and offers a reload button. Read/list and
legacy edit/delete remain available. Once SQL is installed, reload the compose
page to enable four-digit PIN creation. The UI changes can be deployed while
this explicit database step is pending; this must not be described as a fully
validated hosted PIN upgrade before the SQL is installed.

Business failures are returned as
`{ "error": { "code": "REVIEW_...", "message": "..." } }`, even when the HTTP
response is 200. The frontend must check this envelope before treating a request
as successful. Codes are `REVIEW_INVALID_INPUT`, `REVIEW_NOT_FOUND`,
`REVIEW_PASSWORD_INCORRECT` and `REVIEW_RATE_LIMITED`. PostgREST infrastructure
errors remain ordinary non-2xx responses.

## Password and permission boundaries

- Passwords are sent only over HTTPS when creating, editing or deleting a post.
  They must not be stored in browser storage or written into URLs.
- The database SHA-256-prehashes the password and then uses salted bcrypt with
  work factor 12. Prehashing prevents bcrypt's 72-byte input limit from silently
  truncating long or Korean passwords. Only the resulting salted hash is stored.
- Anonymous/authenticated visitors cannot access the private schema, tables,
  password helpers or rate-limit state. RLS is enabled with no public policies.
- Public RPCs use explicit safe output fields; none returns a password/hash.
  `SECURITY DEFINER` functions use `search_path = pg_catalog` and fully qualified
  object references. The migration supports pgcrypto in its existing namespace.
- A project owner with database administrator access can remove a post through
  Supabase's dashboard. No administrator credential belongs in the public app.

## Abuse limits and remaining operating constraints

Limits are enforced in the database, not through a client-supplied visitor ID:

- At most 120 create/update/delete requests per minute across the board.
- At most 12 post-creation attempts per minute across the board.
- At most 8 password attempts per post in 15 minutes. A successful password
  check clears that post's bucket. A blocked post may need to wait 15 minutes
  from the bucket's start before its password can be checked again.

Failed password checks return a JSON error instead of throwing SQL exceptions,
so their counter increments commit rather than rolling back. Fixed-window
counters are updated atomically under concurrent calls. Old unused counters are
removed on later writes. No visitor IP address or IP hash is collected by this
schema.

Keep the Data API's normal commit behavior. Do not enable a PostgREST
transaction-rollback override (`db-tx-end = commit-allow-override`) for anonymous
write requests: a caller-controlled rollback would also undo attempt counters.

These are shared limits, **not per-person limits**. They can temporarily affect
legitimate users on a busy or attacked board. This does not claim to prevent all
spam: determined visitors can still submit up to the shared limits, and an
attacker can exhaust a post's password-attempt budget. Before higher-volume
public operation, add a trusted Edge Function/gateway with server-verified
Turnstile/CAPTCHA and appropriately trusted request metadata, then restrict
direct write RPC access to that gateway. Do not treat an arbitrary client header
or localStorage ID as trusted identity.

Use plain text rendering in the frontend (`textContent`, not `innerHTML` for
visitor fields) so stored HTML is never interpreted as executable markup.

## Local integration validation

These checks require Docker and Python 3 and run only against an isolated local
PostgreSQL 17 container. No host port is exposed and no real Supabase project is
used. The test script truncates its test tables and refuses a container not
matching this image/network configuration.

From the repository root:

```sh
docker run --detach --rm --name number-select-reviews-validation --network none \
  --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
docker exec number-select-reviews-validation pg_isready --host 127.0.0.1 --username postgres
```

After `pg_isready` reports accepting connections, initialize local-only API roles
and simulate broad platform default grants, then apply the migration:

```sh
docker exec --interactive number-select-reviews-validation \
  psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
SQL
docker exec --interactive number-select-reviews-validation \
  psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 < supabase/schema.sql
python3 supabase/tests/run.py
docker stop number-select-reviews-validation
```

The tests exercise persisted create/read/update/delete, private-data permissions,
Unicode password truncation resistance, committed failed attempts, shared
concurrent request caps, pagination and migration repeatability. Review the
reported pass/fail output; static SQL syntax checks alone do not validate the
password/permission boundaries.

For the combined schema/table rename, run `python3 supabase/tests/rename.py`.
It creates and removes its own isolated PostgreSQL container and requires Git
history containing pre-rename commit `09f54c9` to recreate the deployed schema.
The suite verifies existing data, hashes, timestamps, rate-limit state, object
identities and permissions, plus partial renames and transactional rollback.
