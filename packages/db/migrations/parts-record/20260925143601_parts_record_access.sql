-- Access and views for the parts_record schema (packages/db/README.md, "Adding tables to a
-- module"; services/parts-record/README.md). Depends on core (track_updated_at) and switches
-- (switches.state). The module reads detail-evidence's, parts-rules', parts-ai's and
-- product-catalogue's views from its code, not from these views, so module.json lists them for
-- apply order only.
--
-- Records and parts are pipeline data with no user rows, so there is no user_id and no RLS, as
-- in parts_rules and parts_ai. Only the pipeline role (nabvy_pipeline; per-module roles are
-- question 2 of the catalogue) reads and writes the tables, with the least it needs: rows are
-- inserted once and never rewritten (a new extractor version is a new record row), except a
-- reviewer's correction beside a part; delete only for erase() (rule 12: seller-rights erasure).
-- nabvy_app gets nothing: the module publishes no user-facing view; quotes reach users through
-- spec-match after redaction.

grant usage on schema parts_record to nabvy_pipeline;
grant select, insert, delete on parts_record.records, parts_record.parts to nabvy_pipeline;
grant update (correction) on parts_record.parts to nabvy_pipeline;

select nabvy_core.track_updated_at('parts_record.parts');

-- Internal views: security_invoker, explicit columns, never a seller field (no input carries
-- one; the record has none, PARTS_INTELLIGENCE.md:250). Both show only the latest record of each
-- listing version: the row with the latest recorded_at (then the latest id) among the same
-- listing and evidence hash. Empty while the module's switch is off (rule 11); shadow and on
-- show rows.

-- The latest record of each listing version: the kind the record owns, who settled it and where,
-- the extractor versions it merged, the part count and whether any two parts disagree.
create view parts_record.v_records with (security_invoker = true) as
select distinct on (r.listing_id, r.evidence_hash)
  r.listing_id, r.evidence_hash, r.kind, r.kind_gap, r.kind_by, r.kind_source, r.kind_quote,
  r.kind_start, r.kind_end, r.rule_version, r.ai_version, r.photo_version,
  r.part_count as parts, r.conflict, r.recorded_at
from parts_record.records r
where switches.state('parts-record') <> 'off'
order by r.listing_id, r.evidence_hash, r.recorded_at desc, r.id desc;

-- Every part of the latest record of each listing version. `inclusion` is the record's
-- decision: the reviewer's correction when there is one, else the extractor's reading; a
-- rejected row stays, flagged, so readers can leave it out and reviewers can see it.
create view parts_record.v_parts with (security_invoker = true) as
select
  p.listing_id, p.evidence_hash, p.seq, p.part_type, p.catalogue_id, p.attrs,
  coalesce(p.correction ->> 'inclusion', p.inclusion) as inclusion,
  coalesce((p.correction ->> 'rejected')::boolean, false) as rejected,
  p.source, p.extractor, p.extractor_version, p.quote, p.quote_start as "start",
  p.quote_end as "end", p.conflict, p.correction
from parts_record.parts p
join (
  select distinct on (r.listing_id, r.evidence_hash) r.id
  from parts_record.records r
  order by r.listing_id, r.evidence_hash, r.recorded_at desc, r.id desc
) latest on latest.id = p.record_id
where switches.state('parts-record') <> 'off';

revoke all on parts_record.v_records, parts_record.v_parts from public, anon, authenticated;
grant select on parts_record.v_records, parts_record.v_parts to nabvy_pipeline;
