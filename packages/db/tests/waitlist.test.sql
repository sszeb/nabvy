-- waitlist module tests, run by pnpm db:dry-run (packages/db/README.md; global view and Data API
-- checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

-- nabvy_app has no privilege on waitlist.entries at all, not even INSERT or SELECT: it writes only
-- through the SECURITY DEFINER function waitlist.join(...) (PR #31 review) -------------------
do $$
begin
  set local role nabvy_app;
  begin
    insert into waitlist.entries (email) values ('probe-direct-insert@example.com');
    raise exception 'nabvy_app inserted directly into waitlist.entries';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  begin
    perform 1 from waitlist.entries where email = 'anything@example.com';
    raise exception 'nabvy_app selected from waitlist.entries';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- nabvy_pipeline cannot write at all --------------------------------------------------------
do $$
begin
  set local role nabvy_pipeline;
  begin
    insert into waitlist.entries (email) values ('probe-pipeline@example.com');
    raise exception 'nabvy_pipeline inserted a waitlist entry';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- waitlist.join(...): nabvy_app can call it, it inserts, and it is idempotent on email --------
set local role nabvy_app;
select waitlist.join('probe@example.com', 'PO19 8HR', array['RTX 3080'], 'reddit', null, null, null, null);
select waitlist.join('Probe@Example.com', 'SW1A 1AA', array['RTX 3090'], 'google', null, null, null, null);
reset role;

do $$
declare
  seen integer;
  stored_postcode text;
begin
  select count(*) into seen from waitlist.entries where email = 'probe@example.com';
  if seen <> 1 then raise exception 'waitlist.join wrote % rows for a repeat address', seen; end if;

  select postcode into stored_postcode from waitlist.entries where email = 'probe@example.com';
  if stored_postcode <> 'PO19 8HR' then
    raise exception 'waitlist.join overwrote the first entry: postcode is %', stored_postcode;
  end if;
end;
$$;

-- No role may delete a waitlist entry --------------------------------------------------------
do $$
begin
  set local role nabvy_app;
  begin
    delete from waitlist.entries where email = 'probe@example.com';
    raise exception 'nabvy_app deleted a waitlist entry';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- waitlist.join(...) still enforces the email-lower-case and postcode-format check constraints -
do $$
begin
  set local role nabvy_app;
  begin
    perform waitlist.join('Mixed-Case@example.com', null, null, null, null, null, null, null);
    raise exception 'a mixed-case email was not refused';
  exception when check_violation then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  begin
    perform waitlist.join('bad-postcode@example.com', 'NOTAPOSTCODE', null, null, null, null, null, null);
    raise exception 'a malformed postcode was not refused';
  exception when check_violation then null;
  end;
  reset role;
end;
$$;

-- Only nabvy_app may call waitlist.join(...) -------------------------------------------------
do $$
declare
  callers text;
begin
  select string_agg(grantee, ',' order by grantee) into callers
  from information_schema.role_routine_grants
  where routine_schema = 'waitlist' and routine_name = 'join' and privilege_type = 'EXECUTE'
    and grantee <> 'postgres';
  if callers <> 'nabvy_app' then
    raise exception 'waitlist.join callers changed: %', callers;
  end if;
end;
$$;

-- v_waitlist: column allowlist, and the switches filter (rule 11 of _rules.md) ----------------
do $$
declare
  cols text;
  seen integer;
begin
  select string_agg(column_name, ',' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'waitlist' and table_name = 'v_waitlist';
  if cols <> 'id,email,postcode,wanted_products,utm_source,utm_medium,utm_campaign,utm_term,utm_content,created_at'
  then raise exception 'v_waitlist column list changed: %', cols; end if;

  -- No row in switches.switches for 'waitlist' yet: switches.state() reads 'off' for an unknown
  -- name, so the view must hide the probe row even though it exists in the table.
  select count(*) into seen from waitlist.v_waitlist where email = 'probe@example.com';
  if seen <> 0 then raise exception 'v_waitlist shows a row while the switch is off'; end if;
end;
$$;

insert into switches.switches (name, kind, state) values ('waitlist', 'module', 'shadow');

do $$
declare
  seen integer;
begin
  select count(*) into seen from waitlist.v_waitlist where email = 'probe@example.com';
  if seen <> 1 then raise exception 'v_waitlist hides a row while the switch is shadow'; end if;
end;
$$;

update switches.switches set state = 'off' where name = 'waitlist';

do $$
declare
  seen integer;
begin
  select count(*) into seen from waitlist.v_waitlist where email = 'probe@example.com';
  if seen <> 0 then raise exception 'v_waitlist shows a row once the switch is off again'; end if;
end;
$$;

-- Grants: exactly nabvy_pipeline reads v_waitlist (rule 5 of _rules.md: internal view) --------
do $$
declare
  readers text;
begin
  select string_agg(grantee, ',' order by grantee) into readers
  from information_schema.role_table_grants
  where table_schema = 'waitlist' and table_name = 'v_waitlist' and privilege_type = 'SELECT'
    and grantee <> 'postgres'; -- the view's owner, granted implicitly
  if readers <> 'nabvy_pipeline' then
    raise exception 'waitlist.v_waitlist readers changed: %', readers;
  end if;
end;
$$;

-- The rate-limit counter is reachable only by nabvy_app ---------------------------------------
do $$
begin
  set local role nabvy_pipeline;
  begin
    insert into waitlist.submission_attempts (key, window_start) values ('probe', now());
    raise exception 'nabvy_pipeline wrote a rate-limit row';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

rollback;
