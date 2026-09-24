-- Stand-ins for what a Supabase project provides, so the migrations can be dry-run on plain
-- Postgres (CI service container or a local server). Never applied to a real project.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end;
$$;

create schema if not exists extensions;
create schema if not exists net;

-- pg_net is a Supabase extension; the dry-run skips `create extension pg_net` and uses this.
create or replace function net.http_post(
  url text, body jsonb, headers jsonb, timeout_milliseconds integer
) returns bigint language sql as 'select 1::bigint';
