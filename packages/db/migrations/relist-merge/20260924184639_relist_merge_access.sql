-- Access and views for the relist_merge schema (packages/db/README.md, "Adding tables to a
-- module"; services/relist-merge/README.md). Depends on core (uuidv7, track_updated_at),
-- switches (switches.state), listing-ingest (v_listings) and detail-evidence (v_fingerprints,
-- v_text), whose views the module reads.
--
-- Relist groups are pipeline data with no user rows, so there is no user_id and no RLS, as in
-- detail_evidence. Only the pipeline role (nabvy_pipeline; per-module roles are question 2 of the
-- catalogue) reads and writes the tables; it may delete only for erase() (rule 12: seller-rights
-- erasure). nabvy_app gets nothing: a relist group ID, "relisted" or "seen before" is never shown
-- to users (rule 5; fb-scrap-engine/docs/design/SELLER_DATA.md:153-155,289-290,337).

grant usage on schema relist_merge to nabvy_pipeline;
grant select, insert, update, delete on relist_merge.groups, relist_merge.members
  to nabvy_pipeline;

select nabvy_core.track_updated_at('relist_merge.groups');
select nabvy_core.track_updated_at('relist_merge.members');

-- Internal view: security_invoker, explicit columns, no seller field or seller key (none is
-- stored). Empty while the module's switch is off (rule 11); shadow and on show rows, since the
-- module has no user-facing output.
create view relist_merge.v_groups with (security_invoker = true) as
select
  m.group_id, m.listing_id, m.basis, m.matched_listing_id, m.input_fetched_at, m.merged_at,
  g.created_at as group_created_at
from relist_merge.members m
join relist_merge.groups g on g.id = m.group_id
where switches.state('relist-merge') <> 'off';

revoke all on relist_merge.v_groups from public, anon, authenticated;
grant select on relist_merge.v_groups to nabvy_pipeline;
