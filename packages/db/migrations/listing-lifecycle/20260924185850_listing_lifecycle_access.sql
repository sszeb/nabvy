-- Access and views for the listing_lifecycle schema (packages/db/README.md, "Adding tables to a
-- module"; services/listing-lifecycle/README.md). Depends on core (uuidv7, track_updated_at) and
-- switches (switches.state). The module reads listing-ingest's and detail-evidence's views at run
-- time only, so no object here references them.
--
-- Status and rechecks are pipeline data with no user rows (a recheck names the asking module, never
-- a user), so there is no user_id and no RLS, as in listing_ingest. Only the pipeline role
-- (nabvy_pipeline; per-module roles are question 2 of the catalogue) reads and writes the tables.
-- It may delete only for erase() (rule 12: seller-rights erasure). nabvy_app gets nothing: this
-- module publishes no user-facing view (rule 5; acquisition modules run before
-- listing-suppression).

grant usage on schema listing_lifecycle to nabvy_pipeline;
grant select, insert, update, delete on listing_lifecycle.status, listing_lifecycle.rechecks
  to nabvy_pipeline;

select nabvy_core.track_updated_at('listing_lifecycle.status');
select nabvy_core.track_updated_at('listing_lifecycle.rechecks');

-- A recheck step is handed on once: once sent, its time and outcome never change, so a replayed
-- tick cannot send it again or rewrite what happened.
create function listing_lifecycle.rechecks_sent_once() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.sent_at is not null
     and (new.sent_at is distinct from old.sent_at or new.outcome is distinct from old.outcome
          or new.due_at is distinct from old.due_at) then
    raise exception 'listing_lifecycle.rechecks: step % of % was already sent', old.step, old.listing_id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function listing_lifecycle.rechecks_sent_once() from public;

create trigger rechecks_sent_once
  before update on listing_lifecycle.rechecks
  for each row execute function listing_lifecycle.rechecks_sent_once();

-- Internal view: security_invoker, explicit columns, nothing seller-derived (the module stores no
-- seller field). Empty while the module's switch is off (rule 11: "status is unknown", and readers
-- read a missing row as unknown); shadow and on show rows. The input hash and the changing key are
-- the module's own bookkeeping and stay out.
create view listing_lifecycle.v_status with (security_invoker = true) as
select
  s.listing_id, s.source, s.source_listing_id, s.status, s.basis, s.last_seen_at, s.observed_at,
  s.missed_sweeps, s.changed_at
from listing_lifecycle.status s
where switches.state('listing-lifecycle') <> 'off';

revoke all on listing_lifecycle.v_status from public, anon, authenticated;
grant select on listing_lifecycle.v_status to nabvy_pipeline;
