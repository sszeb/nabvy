-- Access and views for the listing_assessment schema (packages/db/README.md, "Adding tables to a
-- module"; services/listing-assessment/README.md). Depends on core (track_updated_at), switches
-- (switches.state) and parts-record (v_assessments shows parts_record.v_records.kind beside its
-- own columns: parts-record owns the kind, and this schema stores none). The module reads
-- detail-evidence's and listing-ingest's views from its code, so module.json lists them for
-- apply order.
--
-- Assessments are pipeline data with no user rows, so there is no user_id and no RLS, as in
-- parts_record. Only the pipeline role (nabvy_pipeline; per-module roles are question 2 of the
-- catalogue) reads and writes the table, with the least it needs: rows are inserted once and
-- never rewritten (a new input is a new row), except a reviewer's correction beside an
-- assessment; delete only for erase() (rule 12: seller-rights erasure). nabvy_app gets nothing:
-- the module publishes no user-facing view.

grant usage on schema listing_assessment to nabvy_pipeline;
grant select, insert, delete on listing_assessment.assessments to nabvy_pipeline;
grant update (correction) on listing_assessment.assessments to nabvy_pipeline;

select nabvy_core.track_updated_at('listing_assessment.assessments');

-- Internal views: security_invoker, explicit columns, never a seller field (no input carries
-- one). Both show only the latest assessment of each listing version: the row with the latest
-- assessed_at (then the latest id) among the same listing and evidence hash. The decisions apply
-- a reviewer's correction when there is one; the correction stays beside them. Empty while the
-- module's switch is off (rule 11); shadow and on show rows.

-- The latest assessment of each listing version, with parts-record's kind for that version (a
-- left join: with parts-record off the kind reads null, unknown, never a value of its own).
create view listing_assessment.v_assessments with (security_invoker = true) as
select
  a.listing_id, a.evidence_hash, a.card_hash, r.kind,
  coalesce(a.correction ->> 'form', a.form) as form,
  coalesce((a.correction ->> 'container')::boolean, a.container) as container,
  a.container_reason,
  coalesce(a.correction ->> 'gpuState', a.gpu_state) as gpu_state,
  a.cautions, a.coverage, a.confirmed_parts, a.exclusions, a.extras, a.rule_version,
  a.assessed_at, a.correction
from (
  select distinct on (x.listing_id, x.evidence_hash) x.*
  from listing_assessment.assessments x
  order by x.listing_id, x.evidence_hash, x.assessed_at desc, x.id desc
) a
left join parts_record.v_records r
  on r.listing_id = a.listing_id and r.evidence_hash = a.evidence_hash
where switches.state('listing-assessment') <> 'off';

-- Each core part (config: unknownPartTypes) the latest assessment of a container does not
-- state, for "ask the seller" (prepared-message). A GPU a reviewer has since stated is left out.
create view listing_assessment.v_unknowns with (security_invoker = true) as
select a.listing_id, a.evidence_hash, u.part_type
from (
  select distinct on (x.listing_id, x.evidence_hash)
    x.listing_id, x.evidence_hash, x.unknowns,
    coalesce((x.correction ->> 'container')::boolean, x.container) as container,
    coalesce(x.correction ->> 'gpuState', x.gpu_state) as gpu_state
  from listing_assessment.assessments x
  order by x.listing_id, x.evidence_hash, x.assessed_at desc, x.id desc
) a
cross join lateral jsonb_array_elements_text(a.unknowns) as u (part_type)
where a.container
  and (u.part_type <> 'gpu' or a.gpu_state = 'not_stated')
  and switches.state('listing-assessment') <> 'off';

revoke all on listing_assessment.v_assessments, listing_assessment.v_unknowns
  from public, anon, authenticated;
grant select on listing_assessment.v_assessments, listing_assessment.v_unknowns to nabvy_pipeline;
