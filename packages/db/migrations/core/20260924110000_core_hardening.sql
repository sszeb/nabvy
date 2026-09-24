-- Core hardening after review of PR #5 (findings 1–3). Forward-only: the foundation migration is
-- never edited once merged.

-- 1. NOBYPASSRLS even if the roles already existed before the foundation migration, which skips
-- `create role` when a role exists. Altered only when needed, so a project where they are
-- already correct never needs the privilege to change the attribute.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'nabvy_app' and rolbypassrls) then
    alter role nabvy_app nobypassrls;
  end if;
  if exists (select 1 from pg_roles where rolname = 'nabvy_pipeline' and rolbypassrls) then
    alter role nabvy_pipeline nobypassrls;
  end if;
end;
$$;

-- 3. Functions added to nabvy_core later: a per-schema `alter default privileges ... revoke
-- execute ... from public` cannot remove Postgres's global EXECUTE-to-PUBLIC default, and a global
-- one would also change Supabase's and the gateway's functions. Instead the dry-run fails when any
-- nabvy_core function other than uuidv7() and current_user_id() is executable by an application
-- role (packages/db/tests/core.test.sql), so a new function must revoke PUBLIC in its migration.

-- 2. View checks over every view in a module schema, not only `v_` ones:
--   * every plain view in a module schema is security_invoker, whatever its name, since a view
--     granted to an application role would otherwise run as its owner and bypass RLS;
--   * no view or materialised view that is a read interface (`v_`, `mv_`) or that nabvy_app can
--     select exposes a seller-identity or raw-row column. Materialised views have no RLS at all.
-- Module schemas are the ones the migration ledger knows, so Supabase's and the gateway's own
-- schemas are out of scope.
create or replace function nabvy_core.view_violations()
returns table (view_name text, problem text)
language sql stable
set search_path = pg_catalog
as $$
  with module_schemas as (
    select distinct replace(module, '-', '_') as nspname
    from nabvy_core.schema_migrations
    where module <> 'core'
  ),
  relations as (
    select c.oid, c.relkind, c.relname, n.nspname, c.reloptions,
           format('%I.%I', n.nspname, c.relname) as qualified
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join module_schemas m on m.nspname = n.nspname
    where c.relkind in ('v', 'm')
  )
  select r.qualified, 'view is not security_invoker'
  from relations r
  where r.relkind = 'v'
    and not exists (
      select 1 from unnest(coalesce(r.reloptions, '{}')) as option
      where option in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')
    )
  union all
  select r.qualified,
         format('exposes column %I, which may identify a seller or carry the raw provider row', a.attname)
  from relations r
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  where (r.relname like 'v\_%' or r.relname like 'mv\_%'
         or has_table_privilege('nabvy_app', r.oid, 'select'))
    and a.attname ~* '(seller|profile_(url|link|pic|picture|image)|^raw$|^raw_|_raw$|source_fields)'
$$;
revoke all on function nabvy_core.view_violations() from public;
