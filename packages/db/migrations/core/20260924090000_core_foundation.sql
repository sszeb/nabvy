-- Nabvy core (task 0.2–0.3 foundation). Shared machinery every module builds on; see
-- packages/db/README.md. Hand-written; applied first by packages/db/scripts/migrate.mjs.

-- Extensions live in Supabase's `extensions` schema. PostGIS is included: the CI image installs
-- it, and hunts need distance queries even though search planning no longer uses H3 cells.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists postgis with schema extensions;

create schema if not exists nabvy_core;
comment on schema nabvy_core is
  'Nabvy core: uuidv7(), the RLS helpers, the migration ledger. Internal; not exposed to the Data API.';
revoke all on schema nabvy_core from public;

-- The migration ledger. The runner also creates it (bootstrap), so this is a no-op there.
create table if not exists nabvy_core.schema_migrations (
  module text not null,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now(),
  primary key (module, name)
);

-- Application roles (docs/engineering.md, "Database access"). Neither may bypass RLS. They are
-- created without LOGIN; the coordinator enables login and sets passwords out of band on the live
-- project, so no credential is ever in a migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nabvy_app') then
    create role nabvy_app nologin nobypassrls noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'nabvy_pipeline') then
    create role nabvy_pipeline nologin nobypassrls noinherit;
  end if;
end;
$$;
comment on role nabvy_app is 'Nabvy web app. Subject to RLS; user rows only inside withUser.';
comment on role nabvy_pipeline is 'Nabvy pipeline tasks. Subject to RLS with role-scoped policies.';

-- Supabase's default search path, so vector and trigram operators resolve for both roles.
alter role nabvy_app set search_path = "$user", public, extensions;
alter role nabvy_pipeline set search_path = "$user", public, extensions;

grant usage on schema extensions to nabvy_app, nabvy_pipeline;
grant usage on schema nabvy_core to nabvy_app, nabvy_pipeline;

-- UUID version 7 (RFC 9562 §5.7): 48-bit Unix milliseconds, then random bits. Built from
-- gen_random_uuid(), whose version nibble 0100 becomes 0111 by setting bits 52 and 53; its
-- variant bits are already RFC 9562's. Postgres 18 has a native uuidv7(); this one is qualified,
-- so the two never clash.
create or replace function nabvy_core.uuidv7() returns uuid
language sql volatile parallel safe
set search_path = pg_catalog
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;

-- The user set by withUser for this transaction, or null outside it.
create or replace function nabvy_core.current_user_id() returns uuid
language sql stable parallel safe
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Trigger function keeping updated_at current; attach with nabvy_core.track_updated_at.
create or replace function nabvy_core.set_updated_at() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function nabvy_core.track_updated_at(target regclass) returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  execute format('drop trigger if exists set_updated_at on %s', target);
  execute format(
    'create trigger set_updated_at before update on %s for each row execute function nabvy_core.set_updated_at()',
    target
  );
end;
$$;

-- The standard user-row policy (docs/engineering.md): nabvy_app sees and writes only rows whose
-- user column equals the withUser user. Enables RLS, so every other role is denied until a policy
-- grants it (see allow_pipeline). Grants stay explicit in the module's migration.
create or replace function nabvy_core.enable_user_rls(target regclass, user_column name default 'user_id')
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  execute format('alter table %s enable row level security', target);
  execute format('drop policy if exists user_isolation on %s', target);
  execute format(
    'create policy user_isolation on %s for all to nabvy_app using (%I = nabvy_core.current_user_id()) with check (%I = nabvy_core.current_user_id())',
    target, user_column, user_column
  );
end;
$$;

-- A role-scoped pipeline policy for one command (select, insert, update, delete or all). The
-- policy admits every row; what the pipeline may do is still limited by the table grants.
create or replace function nabvy_core.allow_pipeline(target regclass, command text default 'all')
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  policy_name text := 'pipeline_' || lower(command);
begin
  if lower(command) not in ('select', 'insert', 'update', 'delete', 'all') then
    raise exception 'allow_pipeline: unknown command %', command;
  end if;
  execute format('alter table %s enable row level security', target);
  execute format('drop policy if exists %I on %s', policy_name, target);
  if lower(command) = 'insert' then
    execute format('create policy %I on %s for insert to nabvy_pipeline with check (true)', policy_name, target);
  elsif lower(command) in ('select', 'delete') then
    execute format('create policy %I on %s for %s to nabvy_pipeline using (true)', policy_name, target, command);
  else
    execute format(
      'create policy %I on %s for %s to nabvy_pipeline using (true) with check (true)',
      policy_name, target, command
    );
  end if;
end;
$$;

-- Conventions every module's views must meet (packages/db/README.md, "Views"), as rows of
-- problems; empty means clean. Checked by the dry-run tests and runnable on the live project.
--   * `v_` views run with the caller's rights (security_invoker), so RLS still applies;
--   * no `v_` view exposes seller identity or the raw provider row (docs/decisions.md, "Actor
--     data kept in full"): users read only through these views.
create or replace function nabvy_core.view_violations()
returns table (view_name text, problem text)
language sql stable
set search_path = pg_catalog
as $$
  select format('%I.%I', n.nspname, c.relname),
         'v_ view is not security_invoker'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v'
    and c.relname like 'v\_%'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and not coalesce(
      exists (
        select 1 from unnest(c.reloptions) as option
        where option in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')
      ),
      false
    )
  union all
  select format('%I.%I', n.nspname, c.relname),
         format('exposes column %I, which may identify a seller or carry the raw provider row', a.attname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relkind in ('v', 'm')
    and c.relname like 'v\_%'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and a.attname ~* '(seller|profile_(url|link|pic|picture|image)|^raw$|^raw_|_raw$|source_fields)'
$$;

revoke all on all functions in schema nabvy_core from public;
grant execute on function nabvy_core.uuidv7(), nabvy_core.current_user_id() to nabvy_app, nabvy_pipeline;
