-- waitlist module tests, run by pnpm db:dry-run (packages/db/README.md; global view and Data API
-- checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

-- Only nabvy_app writes entries; nabvy_pipeline cannot insert, and neither role can delete ----
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

set local role nabvy_app;
insert into waitlist.entries (email, postcode, wanted_products, utm_source)
values ('probe@example.com', 'PO19 8HR', array['RTX 3080'], 'reddit');
reset role;

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

-- A repeat address is refused by the unique constraint (services/waitlist upserts on it) ------
do $$
begin
  set local role nabvy_app;
  begin
    insert into waitlist.entries (email) values ('probe@example.com');
    raise exception 'a duplicate email was not refused';
  exception when unique_violation then null;
  end;
  reset role;
end;
$$;

-- The email-lower-case and postcode-format check constraints ---------------------------------
do $$
begin
  set local role nabvy_app;
  begin
    insert into waitlist.entries (email) values ('Mixed-Case@example.com');
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
    insert into waitlist.entries (email, postcode) values ('bad-postcode@example.com', 'NOTAPOSTCODE');
    raise exception 'a malformed postcode was not refused';
  exception when check_violation then null;
  end;
  reset role;
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
