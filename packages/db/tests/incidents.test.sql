-- incidents module tests, run by pnpm db:dry-run (packages/db/README.md; global view and Data
-- API checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

-- Only the owning roles can write, and neither can delete -----------------------------------
do $$
begin
  set local role nabvy_app;
  begin
    insert into incidents.incidents (event_type, event_key, payload, error, attempts, first_failed_at)
    values ('probe.failed', 'probe:app-insert', '{}', '{"code": "probe.err", "message": "x"}', 1, now());
    raise exception 'nabvy_app inserted an incident';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

set local role nabvy_pipeline;
insert into incidents.incidents (event_type, event_key, payload, error, attempts, first_failed_at)
values (
  'probe.failed', 'probe:one',
  '{"id": "00000000-0000-7000-8000-000000000001", "type": "probe.failed", "v": 1, "at": "2026-09-24T00:00:00.000Z", "key": "probe:one", "payload": {}}',
  '{"code": "probe.err", "message": "boom"}',
  3, '2026-09-24T00:00:00.000Z'
);
reset role;

do $$
begin
  set local role nabvy_pipeline;
  begin
    delete from incidents.incidents where event_key = 'probe:one';
    raise exception 'nabvy_pipeline deleted an incident';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- Idempotent upsert on event_key (what services/incidents' record() relies on) ---------------
set local role nabvy_pipeline;
insert into incidents.incidents (event_type, event_key, payload, error, attempts, first_failed_at)
values (
  'probe.failed', 'probe:one',
  '{"id": "00000000-0000-7000-8000-000000000001", "type": "probe.failed", "v": 1, "at": "2026-09-24T00:00:00.000Z", "key": "probe:one", "payload": {}}',
  '{"code": "probe.err", "message": "boom again"}',
  4, '2026-09-24T00:00:00.000Z'
)
on conflict (event_key) do update set attempts = excluded.attempts, error = excluded.error;
reset role;

do $$
declare
  seen integer;
begin
  select count(*) into seen from incidents.incidents where event_key = 'probe:one';
  if seen <> 1 then raise exception 'event_key is not unique: % rows for probe:one', seen; end if;
end;
$$;

-- nabvy_app resolves an incident (update only, no insert) but cannot resolve twice -----------
set local role nabvy_app;
update incidents.incidents set resolved_at = now() where event_key = 'probe:one';
reset role;

do $$
declare
  seen integer;
begin
  select count(*) into seen
  from incidents.incidents where event_key = 'probe:one' and resolved_at is null;
  if seen <> 0 then raise exception 'nabvy_app could not resolve the incident'; end if;
end;
$$;

-- v_open: column allowlist, and only unresolved rows -----------------------------------------
insert into incidents.incidents (event_type, event_key, payload, error, attempts, first_failed_at)
values (
  'probe.failed', 'probe:two',
  '{"id": "00000000-0000-7000-8000-000000000002", "type": "probe.failed", "v": 1, "at": "2026-09-24T00:00:00.000Z", "key": "probe:two", "payload": {}}',
  '{"code": "probe.err", "message": "still open"}',
  3, '2026-09-24T00:00:00.000Z'
);

do $$
declare
  cols text;
  seen integer;
begin
  select string_agg(column_name, ',' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'incidents' and table_name = 'v_open';
  if cols <> 'id,event_type,event_key,payload,error,attempts,first_failed_at,created_at,updated_at'
  then raise exception 'v_open column list changed: %', cols; end if;

  select count(*) into seen from incidents.v_open where event_key = 'probe:one';
  if seen <> 0 then raise exception 'v_open shows a resolved incident'; end if;

  select count(*) into seen from incidents.v_open where event_key = 'probe:two';
  if seen <> 1 then raise exception 'v_open is missing an open incident'; end if;
end;
$$;

-- Grants: exactly nabvy_app and nabvy_pipeline read v_open -----------------------------------
do $$
declare
  readers text;
begin
  select string_agg(grantee, ',' order by grantee) into readers
  from information_schema.role_table_grants
  where table_schema = 'incidents' and table_name = 'v_open' and privilege_type = 'SELECT'
    and grantee <> 'postgres'; -- the view's owner, granted implicitly, not one of rule 5's readers
  if readers <> 'nabvy_app,nabvy_pipeline' then
    raise exception 'incidents.v_open readers changed: %', readers;
  end if;
end;
$$;

rollback;
