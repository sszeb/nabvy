-- The nabvy_auth role and the account-standing function (task 4.0). Rolled back.
begin;
set local client_min_messages = warning;

-- nabvy_auth: no login in a migration, no RLS bypass, and only Better Auth's four tables.
do $$
declare
  t text;
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'nabvy_auth' and not rolcanlogin and not rolbypassrls and not rolsuper
  ) then
    raise exception 'nabvy_auth is missing, can log in, or bypasses RLS';
  end if;
  foreach t in array array['user', 'session', 'account', 'verification'] loop
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
