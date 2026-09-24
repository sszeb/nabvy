-- details-queue module tests, run by pnpm db:dry-run (packages/db/README.md; global view and Data
-- API checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAILED: %', what;
  end if;
end;
$$;

-- nabvy_app has no privilege at all: the queue holds no user rows and no user-facing view -------
do $$
begin
  set local role nabvy_app;
  begin
    perform 1 from details_queue.v_queue;
    raise exception 'nabvy_app could read v_queue';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into details_queue.items (source, source_listing_id, lane, priority, reason, requested_by)
    values ('facebook', '1', 'text', 'sweep', 'first-seen', 'details-selector');
    raise exception 'nabvy_app inserted an item';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- nabvy_pipeline: batches are never deleted --------------------------------------------------------
do $$
begin
  set local role nabvy_pipeline;
  begin
    delete from details_queue.batches where job_id = -1;
    raise exception 'nabvy_pipeline deleted from batches';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

set local role nabvy_pipeline;
insert into details_queue.items (source, source_listing_id, lane, priority, reason, requested_by, region_id, status, job_id)
values ('facebook', '1816901372840238', 'text', 'new-listing', 'first-seen', 'details-selector', 'chichester', 'leased', 1);
insert into details_queue.leases (source, source_listing_id, job_id, expires_at)
values ('facebook', '1816901372840238', 1, now() + interval '30 minutes');
insert into details_queue.batches (job_id, source, lane, region_id, route, size, source_listing_ids, day)
values (1, 'facebook', 'text', 'chichester', 'graphql', 1, array['1816901372840238'], current_date);
reset role;

-- Keys and checks ------------------------------------------------------------------------------------
do $$
begin
  set local role nabvy_pipeline;
  begin
    insert into details_queue.items (source, source_listing_id, lane, priority, reason, requested_by)
    values ('facebook', '1816901372840238', 'text', 'sweep', 'recheck', 'listing-lifecycle');
    raise exception 'a duplicate (source, listing, lane) item was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into details_queue.leases (source, source_listing_id, job_id, expires_at)
    values ('facebook', '1816901372840238', 2, now());
    raise exception 'a second lease on one listing was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into details_queue.items (source, source_listing_id, lane, priority, reason, requested_by)
    values ('facebook', '2', 'text', 'urgent', 'recheck', 'listing-lifecycle');
    raise exception 'an unknown priority was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into details_queue.batches (job_id, source, lane, region_id, route, size, source_listing_ids, day)
    values (2, 'facebook', 'text', 'x', 'graphql', 201, array['1'], current_date);
    raise exception 'a batch of more than 200 was accepted';
  exception when check_violation then null;
  end;
  update details_queue.batches set closed_at = now() where job_id = 1;
  begin
    update details_queue.batches set closed_at = null where job_id = 1;
    raise exception 'a closed batch was reopened';
  exception when raise_exception then
    if sqlerrm not like '%stays closed%' then raise; end if;
  end;
  reset role;
end;
$$;

-- v_queue: security_invoker, its column allowlist, rows only while the module is not off ----------
insert into switches.switches (name, kind, state) values ('details-queue', 'module', 'on')
  on conflict (name) do update set state = 'on';

do $$
declare
  cols text;
  problems text;
begin
  select string_agg(column_name, ',' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'details_queue' and table_name = 'v_queue';
  if cols <> 'source,source_listing_id,lane,priority,status,reason,requested_by,region_id,attempts,requeues,last_outcome,job_id,lease_expires_at,deferred_on,done_at,created_at,updated_at' then
    raise exception 'v_queue column list changed: %', cols;
  end if;

  select string_agg(view_name || ': ' || problem, '; ') into problems
  from nabvy_core.view_violations() where view_name like 'details\_queue.%';
  if problems is not null then raise exception 'FAILED: view conventions: %', problems; end if;
end;
$$;

select pg_temp.check(count(*) = 1 and bool_and(lease_expires_at is not null), 'v_queue shows the item with its lease')
from details_queue.v_queue;

update switches.switches set state = 'off' where name = 'details-queue';
select pg_temp.check(count(*) = 0, 'v_queue still shows rows while details-queue is off')
from details_queue.v_queue;
select pg_temp.check(count(*) = 1, 'the item itself must stay while off (work is never dropped)')
from details_queue.items;

update switches.switches set state = 'shadow' where name = 'details-queue';
select pg_temp.check(count(*) = 1, 'v_queue must show rows in shadow')
from details_queue.v_queue;

-- Grants: exactly nabvy_pipeline reads v_queue; nothing leaks to the app or the Data API roles ----
do $$
declare
  readers text;
  role_name text;
  leak text;
begin
  select string_agg(grantee, ',' order by grantee) into readers
  from information_schema.role_table_grants
  where table_schema = 'details_queue' and table_name = 'v_queue' and privilege_type = 'SELECT'
    and grantee <> 'postgres';
  if readers <> 'nabvy_pipeline' then
    raise exception 'details_queue.v_queue readers changed: %', readers;
  end if;

  foreach role_name in array array['nabvy_app', 'anon', 'authenticated'] loop
    select string_agg(c.relname, ', ') into leak
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'details_queue' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege(role_name, c.oid, 'select')
           or has_table_privilege(role_name, c.oid, 'insert')
           or has_table_privilege(role_name, c.oid, 'update')
           or has_table_privilege(role_name, c.oid, 'delete'));
    if leak is not null then raise exception 'FAILED: % holds privileges on %', role_name, leak; end if;
    if has_schema_privilege(role_name, 'details_queue', 'usage') then
      raise exception 'FAILED: % can use the details_queue schema', role_name;
    end if;
  end loop;
end;
$$;

select 'details-queue module tests passed';
rollback;
