-- Access for the details_queue schema (packages/db/README.md, "Adding tables to a module").
-- The queue holds no user rows (callers name no user; rule 13: Facebook is never fetched per
-- user), so there is no user_id column and no RLS. Only services/details-queue, running as
-- nabvy_pipeline inside a Trigger.dev task, writes here.

grant usage on schema details_queue to nabvy_pipeline;

-- Items are never deleted by the queue itself: work waits, visible, and is never dropped
-- (card, "When off"). Delete is granted for `erase(listingIds)` only (rule 12).
grant select, insert, update, delete on details_queue.items to nabvy_pipeline;
select nabvy_core.track_updated_at('details_queue.items');

-- A lease lives from submit to close.
grant select, insert, update, delete on details_queue.leases to nabvy_pipeline;

-- Batches are the record of what was sent and when (the daily cap counts them): inserted, then
-- closed once; never deleted.
grant select, insert, update on details_queue.batches to nabvy_pipeline;

-- A batch closes once: closed_at, once set, never changes (so closing twice changes nothing).
create or replace function details_queue.batches_close_once() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.closed_at is not null and new.closed_at is distinct from old.closed_at then
    raise exception 'details_queue.batches: a batch, once closed, stays closed';
  end if;
  return new;
end;
$$;
create trigger batches_close_once before update on details_queue.batches
  for each row execute function details_queue.batches_close_once();

-- The read interface for other modules (ops-metrics, admin pages): every item with its lease.
-- security_invoker (the standing rule for every v_ view) and granted to nabvy_pipeline, as the
-- other acquisition modules' internal views are, until per-module roles exist (rule 5). Rule 11:
-- no rows while the module is off (an unknown switch reads off, so an unreachable switches also
-- empties it); the items themselves stay and wait.
create view details_queue.v_queue with (security_invoker = true) as
  select
    i.source,
    i.source_listing_id,
    i.lane,
    i.priority,
    i.status,
    i.reason,
    i.requested_by,
    i.region_id,
    i.attempts,
    i.requeues,
    i.last_outcome,
    i.job_id,
    l.expires_at as lease_expires_at,
    i.deferred_on,
    i.done_at,
    i.created_at,
    i.updated_at
  from details_queue.items i
  left join details_queue.leases l
    on l.source = i.source and l.source_listing_id = i.source_listing_id and i.status = 'leased'
  where switches.state('details-queue') <> 'off';
grant select on details_queue.v_queue to nabvy_pipeline;
