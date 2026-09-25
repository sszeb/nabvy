-- marketing-consent module tests, run by pnpm db:dry-run (packages/db/README.md; global view and
-- Data API checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

-- marketing_consents: RLS isolates rows by user_id (nabvy_app), the standard pattern
-- (nabvy_core.enable_user_rls) --------------------------------------------------------------
do $$
begin
  set local role nabvy_app;
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000000a1', true);
  insert into marketing_consent.marketing_consents (user_id, category, granted, source)
  values ('00000000-0000-4000-8000-0000000000a1', 'tips', true, 'signup');
  reset role;
end;
$$;

do $$
declare
  seen integer;
begin
  set local role nabvy_app;
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000000a2', true);
  select count(*) into seen from marketing_consent.marketing_consents;
  if seen <> 0 then raise exception 'nabvy_app read another user''s marketing_consents row'; end if;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000000a2', true);
  begin
    insert into marketing_consent.marketing_consents (user_id, category, granted, source)
    values ('00000000-0000-4000-8000-0000000000a1', 'offers', true, 'signup');
    raise exception 'nabvy_app inserted a row for a different user_id';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
declare
  seen integer;
begin
  set local role nabvy_app;
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000000a1', true);
  select count(*) into seen from marketing_consent.marketing_consents;
  if seen <> 1 then raise exception 'nabvy_app could not read its own row'; end if;
  delete from marketing_consent.marketing_consents
    where user_id = '00000000-0000-4000-8000-0000000000a1' and category = 'tips';
  reset role;
end;
$$;

-- nabvy_pipeline: select and delete only (never insert or update: only the user writes their own
-- preferences; the pipeline only reads for v_consents and purges on account.deleted). The fixture
-- row below is written as nabvy_app (the real write path), scoped to its own user_id -----------
do $$
begin
  set local role nabvy_app;
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
  insert into marketing_consent.marketing_consents (user_id, category, granted, source)
  values ('00000000-0000-4000-8000-0000000000b1', 'tips', true, 'signup');
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_pipeline;
  begin
    insert into marketing_consent.marketing_consents (user_id, category, granted, source)
    values ('00000000-0000-4000-8000-0000000000b2', 'tips', true, 'signup');
    raise exception 'nabvy_pipeline inserted into marketing_consents';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_pipeline;
  begin
    update marketing_consent.marketing_consents set granted = false where category = 'tips';
    raise exception 'nabvy_pipeline updated marketing_consents';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- email_suppressions and newsletter_subscribers: nabvy_app has no privilege at all (no user_id,
-- written only from a pipeline context: README.md, "Decisions") -------------------------------
do $$
begin
  set local role nabvy_app;
  begin
    insert into marketing_consent.email_suppressions (email_hash, reason, source)
    values (repeat('a', 64), 'bounce', 'resend');
    raise exception 'nabvy_app inserted into email_suppressions';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  begin
    perform 1 from marketing_consent.email_suppressions;
    raise exception 'nabvy_app selected from email_suppressions';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  begin
    insert into marketing_consent.newsletter_subscribers (email_hash, consent_source)
    values (repeat('b', 64), 'waitlist');
    raise exception 'nabvy_app inserted into newsletter_subscribers';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- nabvy_pipeline: select/insert/update on both, but never delete (a suppression or subscriber
-- record is never removed, only overwritten or marked unsubscribed) ---------------------------
set local role nabvy_pipeline;
insert into marketing_consent.email_suppressions (email_hash, reason, source)
values (repeat('a', 64), 'bounce', 'resend');
insert into marketing_consent.newsletter_subscribers (email_hash, consent_source)
values (repeat('b', 64), 'waitlist');
reset role;

do $$
begin
  set local role nabvy_pipeline;
  begin
    delete from marketing_consent.email_suppressions where email_hash = repeat('a', 64);
    raise exception 'nabvy_pipeline deleted an email_suppressions row';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_pipeline;
  begin
    delete from marketing_consent.newsletter_subscribers where email_hash = repeat('b', 64);
    raise exception 'nabvy_pipeline deleted a newsletter_subscribers row';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- Check constraints: category, source, the pause-only until, and the email-hash format. Inserted
-- as nabvy_app (the only role with an insert grant on marketing_consents), scoped to its own row -
do $$
begin
  set local role nabvy_app;
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000000c1', true);
  begin
    insert into marketing_consent.marketing_consents (user_id, category, granted, source)
    values ('00000000-0000-4000-8000-0000000000c1', 'not-a-category', true, 'signup');
    raise exception 'an unknown category was accepted';
  exception when check_violation then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000000c2', true);
  begin
    insert into marketing_consent.marketing_consents (user_id, category, granted, until, source)
    values ('00000000-0000-4000-8000-0000000000c2', 'tips', false, now(), 'signup');
    raise exception 'a real category was accepted with an until';
  exception when check_violation then null;
  end;
  reset role;
end;
$$;

do $$
begin
  begin
    set local role nabvy_pipeline;
    insert into marketing_consent.email_suppressions (email_hash, reason, source)
    values ('not-a-hash', 'bounce', 'resend');
    raise exception 'a malformed email_hash was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- v_consents: column allowlist, security_invoker's RLS pass-through, and the switches filter ----
do $$
declare
  cols text;
begin
  select string_agg(column_name, ',' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'marketing_consent' and table_name = 'v_consents';
  if cols <> 'user_id,category,granted,until,source,at' then
    raise exception 'v_consents column list changed: %', cols;
  end if;
end;
$$;

-- No row in switches.switches for 'marketing-consent' yet: switches.state() reads 'off' for an
-- unknown name, so the view must hide every row even though b1's row exists in the table.
do $$
declare
  seen integer;
begin
  select count(*) into seen from marketing_consent.v_consents;
  if seen <> 0 then raise exception 'v_consents shows rows while the switch is off (unset)'; end if;
end;
$$;

insert into switches.switches (name, kind, state) values ('marketing-consent', 'module', 'shadow');

do $$
declare
  seen integer;
begin
  select count(*) into seen from marketing_consent.v_consents
  where user_id = '00000000-0000-4000-8000-0000000000b1';
  if seen <> 1 then raise exception 'v_consents hides a row while the switch is shadow'; end if;
end;
$$;

update switches.switches set state = 'off' where name = 'marketing-consent';

do $$
declare
  seen integer;
begin
  select count(*) into seen from marketing_consent.v_consents;
  if seen <> 0 then raise exception 'v_consents shows rows once the switch is off again'; end if;
end;
$$;

update switches.switches set state = 'on' where name = 'marketing-consent';

-- Grants: exactly nabvy_pipeline reads v_consents (rule 5 of _rules.md: internal view), and no
-- role outside nabvy_app/nabvy_pipeline holds anything on the schema ---------------------------
do $$
declare
  readers text;
  role_name text;
  leak text;
begin
  select string_agg(grantee, ',' order by grantee) into readers
  from information_schema.role_table_grants
  where table_schema = 'marketing_consent' and table_name = 'v_consents' and privilege_type = 'SELECT'
    and grantee <> 'postgres';
  if readers <> 'nabvy_pipeline' then
    raise exception 'marketing_consent.v_consents readers changed: %', readers;
  end if;

  foreach role_name in array array['anon', 'authenticated'] loop
    select string_agg(c.relname, ', ') into leak
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'marketing_consent' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege(role_name, c.oid, 'select')
           or has_table_privilege(role_name, c.oid, 'insert')
           or has_table_privilege(role_name, c.oid, 'update')
           or has_table_privilege(role_name, c.oid, 'delete'));
    if leak is not null then raise exception 'FAILED: % holds privileges on %', role_name, leak; end if;
    if has_schema_privilege(role_name, 'marketing_consent', 'usage') then
      raise exception 'FAILED: % can use the marketing_consent schema', role_name;
    end if;
  end loop;
end;
$$;

select 'marketing-consent module tests passed';
rollback;
