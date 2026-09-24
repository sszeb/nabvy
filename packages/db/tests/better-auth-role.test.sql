-- The nabvy_auth role and the account-standing function (task 4.0). Rolled back.
begin;
set local client_min_messages = warning;

-- nabvy_auth: no login in a migration, no RLS bypass, and only Better Auth's own tables.
do $$
declare
  t text;
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'nabvy_auth' and not rolcanlogin and not rolbypassrls and not rolsuper
      and not rolcreatedb and not rolcreaterole and not rolinherit
  ) then
    raise exception 'nabvy_auth is missing, can log in, or bypasses RLS';
  end if;
  foreach t in array array['user', 'session', 'account', 'verification', 'rate_limit'] loop
    if not has_table_privilege('nabvy_auth', format('better_auth.%I', t), 'select,insert,update,delete') then
      raise exception 'nabvy_auth cannot use better_auth.%', t;
    end if;
  end loop;
  if has_table_privilege('nabvy_auth', 'better_auth.subscription', 'select,insert,update,delete') then
    raise exception 'nabvy_auth can use better_auth.subscription before billing needs it';
  end if;
  if has_schema_privilege('nabvy_auth', 'nabvy_core', 'usage')
     or has_function_privilege('nabvy_auth', 'better_auth.seed_founders(text[])', 'execute') then
    raise exception 'nabvy_auth reaches beyond better_auth';
  end if;
  -- No grant on a table in any other schema (grants to PUBLIC, such as PostGIS's
  -- spatial_ref_sys, are everyone's and not counted).
  if exists (
    select 1 from information_schema.role_table_grants
    where grantee = 'nabvy_auth' and table_schema <> 'better_auth'
  ) then
    raise exception 'nabvy_auth has a grant on a table outside better_auth';
  end if;
end;
$$;

-- Better Auth's writes work as nabvy_auth (updated_at trigger included).
set local role nabvy_auth;
insert into better_auth."user" (id, name, email, email_verified)
  values ('00000000-0000-4000-8000-00000000a001', '', 'active@example.com', true),
         ('00000000-0000-4000-8000-00000000a002', '', 'banned@example.com', true),
         ('00000000-0000-4000-8000-00000000a003', '', 'suspended@example.com', true),
         ('00000000-0000-4000-8000-00000000a004', '', 'lapsed@example.com', true);
insert into better_auth.session (token, expires_at, updated_at, user_id)
  values ('probe-token', now() + interval '1 day', now(), '00000000-0000-4000-8000-00000000a001');
update better_auth."user" set banned = true, ban_reason = 'internal only'
  where email = 'banned@example.com';
update better_auth."user" set banned = true, ban_expires = (now() at time zone 'UTC') + interval '7 days'
  where email = 'suspended@example.com';
update better_auth."user" set banned = true, ban_expires = (now() at time zone 'UTC') - interval '1 minute'
  where email = 'lapsed@example.com';
delete from better_auth.session where token = 'probe-token';
reset role;

-- account_active: one boolean for app and pipeline, who still cannot read the rows.
do $$
begin
  if not better_auth.account_active('00000000-0000-4000-8000-00000000a001') then
    raise exception 'active user reported restricted';
  end if;
  if better_auth.account_active('00000000-0000-4000-8000-00000000a002') then
    raise exception 'banned user reported active';
  end if;
  if better_auth.account_active('00000000-0000-4000-8000-00000000a003') then
    raise exception 'suspended user reported active';
  end if;
  if not better_auth.account_active('00000000-0000-4000-8000-00000000a004') then
    raise exception 'expired suspension still restricts';
  end if;
  if better_auth.account_active('00000000-0000-4000-8000-00000000ffff') then
    raise exception 'unknown user reported active';
  end if;
end;
$$;

set local role nabvy_pipeline;
do $$
begin
  if better_auth.account_active('00000000-0000-4000-8000-00000000a002') then
    raise exception 'pipeline sees a banned user as active';
  end if;
  begin
    perform 1 from better_auth."user";
    raise exception 'pipeline read better_auth.user';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set local role nabvy_app;
do $$
begin
  if not better_auth.account_active('00000000-0000-4000-8000-00000000a001') then
    raise exception 'app sees an active user as restricted';
  end if;
  begin
    perform 1 from better_auth.session;
    raise exception 'app read better_auth.session';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

-- Functions: app and pipeline have USAGE on better_auth for account_active only. Any other
-- better_auth function must have PUBLIC revoked; the check is proved on a probe function first.
create function better_auth.probe_later() returns integer language sql as 'select 1';
create function pg_temp.executable_auth_functions() returns text language sql as $$
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  from pg_proc p
  where p.pronamespace = 'better_auth'::regnamespace
    and p.proname not in ('account_active', 'account_restriction')
    and (has_function_privilege('nabvy_app', p.oid, 'execute')
         or has_function_privilege('nabvy_pipeline', p.oid, 'execute'))
$$;
do $$
begin
  if pg_temp.executable_auth_functions() is distinct from 'better_auth.probe_later()' then
    raise exception 'executable-function check did not catch the probe: %', pg_temp.executable_auth_functions();
  end if;
end;
$$;
drop function better_auth.probe_later();
do $$
begin
  if pg_temp.executable_auth_functions() is not null then
    raise exception 'better_auth functions executable by application roles: %', pg_temp.executable_auth_functions();
  end if;
end;
$$;

-- The restriction policy takes only the three policy names; account_restriction names the step
-- and the policy only.
do $$
declare
  found record;
begin
  update better_auth."user" set restriction_policy = 'fair-use' where email = 'suspended@example.com';
  select * into found from better_auth.account_restriction('00000000-0000-4000-8000-00000000a003');
  if found.step is distinct from 'suspended' or found.policy is distinct from 'fair-use' then
    raise exception 'suspension reported as % under %', found.step, found.policy;
  end if;
  select * into found from better_auth.account_restriction('00000000-0000-4000-8000-00000000a002');
  if found.step is distinct from 'banned' or found.policy is distinct from 'terms' then
    raise exception 'ban reported as % under %', found.step, found.policy;
  end if;
  if exists (select 1 from better_auth.account_restriction('00000000-0000-4000-8000-00000000a001'))
     or exists (select 1 from better_auth.account_restriction('00000000-0000-4000-8000-00000000a004')) then
    raise exception 'an active or lapsed account reported a restriction';
  end if;
  begin
    update better_auth."user" set restriction_policy = 'because we said so' where email = 'banned@example.com';
    raise exception 'an unknown restriction policy was accepted';
  exception when check_violation then
    null;
  end;
end;
$$;

-- anon and authenticated (Supabase's Data API roles) reach nothing in better_auth.
do $$
begin
  if has_schema_privilege('anon', 'better_auth', 'usage')
     or has_schema_privilege('authenticated', 'better_auth', 'usage') then
    raise exception 'a Data API role can use better_auth';
  end if;
end;
$$;

rollback;
