-- Core foundation tests, run by scripts/db-dry-run.sh after every migration is applied.
-- Each block raises on failure; everything runs in one transaction that is rolled back.
begin;
set local client_min_messages = warning;

-- Extensions and uuidv7 ---------------------------------------------------------------------
do $$
declare
  missing text;
  a uuid;
  b uuid;
begin
  select string_agg(name, ', ') into missing
  from unnest(array['pg_trgm', 'vector', 'postgis']) as name
  where not exists (select 1 from pg_extension where extname = name);
  if missing is not null then raise exception 'missing extensions: %', missing; end if;

  a := nabvy_core.uuidv7();
  perform pg_sleep(0.002);
  b := nabvy_core.uuidv7();
  if substr(a::text, 15, 1) <> '7' then raise exception 'uuidv7 version nibble: %', a; end if;
  if substr(a::text, 20, 1) not in ('8', '9', 'a', 'b') then raise exception 'uuidv7 variant: %', a; end if;
  if not (a < b) then raise exception 'uuidv7 not time ordered: % then %', a, b; end if;
  if abs(
    ('x' || substr(replace(a::text, '-', ''), 1, 12))::bit(48)::bigint
    - floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  ) > 60000 then
    raise exception 'uuidv7 timestamp is not now: %', a;
  end if;
end;
$$;

-- Roles --------------------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_roles where rolname in ('nabvy_app', 'nabvy_pipeline')) <> 2 then
    raise exception 'roles nabvy_app and nabvy_pipeline must exist';
  end if;
  if exists (
    select 1 from pg_roles
    where rolname in ('nabvy_app', 'nabvy_pipeline') and (rolbypassrls or rolsuper)
  ) then
    raise exception 'application roles must not bypass RLS';
  end if;
end;
$$;

-- RLS: the 0.3 definition of done, on probe tables built with the standard helpers -----------
create schema rls_probe;
grant usage on schema rls_probe to nabvy_app, nabvy_pipeline;
create table rls_probe.profiles (id uuid primary key default nabvy_core.uuidv7(), user_id uuid not null, note text);
create table rls_probe.hunts (id uuid primary key default nabvy_core.uuidv7(), user_id uuid not null, note text);
create table rls_probe.alerts (id uuid primary key default nabvy_core.uuidv7(), user_id uuid not null, note text);
grant select, insert, update, delete on rls_probe.profiles, rls_probe.hunts, rls_probe.alerts to nabvy_app;
grant select on rls_probe.hunts to nabvy_pipeline;
grant insert on rls_probe.alerts to nabvy_pipeline;
do $$ begin perform nabvy_core.enable_user_rls('rls_probe.profiles'); end $$;
do $$ begin perform nabvy_core.enable_user_rls('rls_probe.hunts'); end $$;
do $$ begin perform nabvy_core.enable_user_rls('rls_probe.alerts'); end $$;
do $$ begin perform nabvy_core.allow_pipeline('rls_probe.hunts', 'select'); end $$;
do $$ begin perform nabvy_core.allow_pipeline('rls_probe.alerts', 'insert'); end $$;
insert into rls_probe.hunts (user_id, note) values
  ('00000000-0000-7000-8000-00000000000a', 'a1'),
  ('00000000-0000-7000-8000-00000000000a', 'a2'),
  ('00000000-0000-7000-8000-00000000000b', 'b1');
insert into rls_probe.profiles (user_id, note) values ('00000000-0000-7000-8000-00000000000a', 'pa');

set local role nabvy_app;
do $$
declare
  seen integer;
begin
  -- Outside withUser: nothing.
  select count(*) into seen from rls_probe.hunts;
  if seen <> 0 then raise exception 'outside withUser nabvy_app saw % rows', seen; end if;

  -- Inside withUser for A: only A's rows.
  perform set_config('app.user_id', '00000000-0000-7000-8000-00000000000a', true);
  select count(*) into seen from rls_probe.hunts;
  if seen <> 2 then raise exception 'user A saw % rows, expected 2', seen; end if;
  if exists (select 1 from rls_probe.hunts where user_id <> '00000000-0000-7000-8000-00000000000a') then
    raise exception 'user A saw another user''s row';
  end if;
  update rls_probe.hunts set note = 'x';
  get diagnostics seen = row_count;
  if seen <> 2 then raise exception 'user A updated % rows, expected 2', seen; end if;

  -- A cannot write a row for B.
  begin
    insert into rls_probe.hunts (user_id, note) values ('00000000-0000-7000-8000-00000000000b', 'forged');
    raise exception 'user A inserted a row for user B';
  exception when insufficient_privilege then null;
  end;

  -- An empty setting (after a withUser transaction on a pooled connection) is no user.
  perform set_config('app.user_id', '', true);
  select count(*) into seen from rls_probe.hunts;
  if seen <> 0 then raise exception 'empty app.user_id saw % rows', seen; end if;
end;
$$;
reset role;

set local role nabvy_pipeline;
do $$
declare
  seen integer;
begin
  -- The pipeline reads hunts (every user's) …
  select count(*) into seen from rls_probe.hunts;
  if seen <> 3 then raise exception 'pipeline saw % hunts, expected 3', seen; end if;
  -- … inserts alerts …
  insert into rls_probe.alerts (user_id, note) values ('00000000-0000-7000-8000-00000000000a', 'deal');
  -- … but cannot read alerts back, write hunts, or read profiles.
  begin
    perform 1 from rls_probe.alerts;
    raise exception 'pipeline read alerts';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into rls_probe.hunts (user_id, note) values ('00000000-0000-7000-8000-00000000000a', 'x');
    raise exception 'pipeline wrote hunts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from rls_probe.profiles;
    raise exception 'pipeline read profiles';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- The helper functions are for migrations only.
do $$
begin
  if has_function_privilege('nabvy_app', 'nabvy_core.enable_user_rls(regclass, name)', 'execute')
     or has_function_privilege('nabvy_pipeline', 'nabvy_core.allow_pipeline(regclass, text)', 'execute') then
    raise exception 'application roles can execute migration helpers';
  end if;
  if not has_function_privilege('nabvy_app', 'nabvy_core.uuidv7()', 'execute') then
    raise exception 'nabvy_app cannot execute uuidv7()';
  end if;
end;
$$;

-- Views: security_invoker and no seller identity ----------------------------------------------
create view rls_probe.v_hunts with (security_invoker = true) as select id, note from rls_probe.hunts;
create view rls_probe.v_leaky as select id, note from rls_probe.hunts;
create view rls_probe.v_sellers with (security_invoker = true) as
  select id, note as seller_name, note as raw from rls_probe.hunts;
do $$
declare
  problems text;
begin
  select string_agg(view_name || ': ' || problem, '; ' order by view_name, problem) into problems
  from nabvy_core.view_violations() where view_name like 'rls\_probe.%';
  if problems is distinct from
     'rls_probe.v_leaky: v_ view is not security_invoker; '
     || 'rls_probe.v_sellers: exposes column raw, which may identify a seller or carry the raw provider row; '
     || 'rls_probe.v_sellers: exposes column seller_name, which may identify a seller or carry the raw provider row'
  then
    raise exception 'view_violations() returned: %', problems;
  end if;
end;
$$;
grant select on rls_probe.v_hunts to nabvy_app;
set local role nabvy_app;
do $$
begin
  if (select count(*) from rls_probe.v_hunts) <> 0 then
    raise exception 'a security_invoker view leaked rows outside withUser';
  end if;
end;
$$;
reset role;

rollback;

-- Conventions on the real migrations (not the probe) -----------------------------------------
do $$
declare
  problems text;
  exposed text;
begin
  select string_agg(view_name || ': ' || problem, '; ') into problems from nabvy_core.view_violations();
  if problems is not null then raise exception 'view conventions broken: %', problems; end if;

  -- No Nabvy table in public (PostgREST exposes it; docs/security.md).
  select string_agg(relname, ', ') into exposed
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f');
  if exposed is not null then raise exception 'relations in public: %', exposed; end if;

  -- Supabase's Data API roles reach no module schema.
  select string_agg(schema_name, ', ') into exposed
  from nabvy_core.schema_migrations m
  cross join lateral (
    select case when m.module = 'core' then 'nabvy_core' else replace(m.module, '-', '_') end as schema_name
  ) s
  where exists (select 1 from pg_namespace where nspname = s.schema_name)
    and (has_schema_privilege('anon', s.schema_name, 'usage')
         or has_schema_privilege('authenticated', s.schema_name, 'usage'));
  if exposed is not null then raise exception 'Data API roles can use schemas: %', exposed; end if;
end;
$$;

-- The ledger records every applied migration.
do $$
begin
  if (select count(*) from nabvy_core.schema_migrations where module = 'core') < 1 then
    raise exception 'core migrations are not in the ledger';
  end if;
end;
$$;
