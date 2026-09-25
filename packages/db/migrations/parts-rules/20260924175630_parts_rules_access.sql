-- Access and views for the parts_rules schema (packages/db/README.md, "Adding tables to a
-- module"; services/parts-rules/README.md). Depends on core (track_updated_at) and switches
-- (switches.state). The module reads detail-evidence's, listing-ingest's and
-- product-catalogue's views from its code, not from these views, so module.json lists them for
-- apply order only.
--
-- Rule runs and hits are pipeline data with no user rows, so there is no user_id and no RLS, as
-- in detail_evidence. Only the pipeline role (nabvy_pipeline; per-module roles are question 2 of
-- the catalogue) reads and writes the tables. It may delete only for erase() (rule 12:
-- seller-rights erasure). nabvy_app gets nothing: the module publishes no user-facing view.

grant usage on schema parts_rules to nabvy_pipeline;
grant select, insert, update, delete on parts_rules.runs, parts_rules.rule_parts to nabvy_pipeline;

select nabvy_core.track_updated_at('parts_rules.runs');
select nabvy_core.track_updated_at('parts_rules.rule_parts');

-- Internal views: security_invoker, explicit columns, never a seller field (the rules read none).
-- Empty while the module's switch is off (rule 11); shadow and on show rows.

-- Every rule hit, with its verbatim quote and its UTF-16 offsets into the stored text.
create view parts_rules.v_rule_parts with (security_invoker = true) as
select
  p.listing_id, p.evidence_hash, p.rule_version, p.seq, p.part_type, p.catalogue_id, p.attrs,
  p.inclusion_candidate, p.source, p.quote, p.quote_start as "start", p.quote_end as "end",
  p.rule_id, p.correction
from parts_rules.rule_parts p
where switches.state('parts-rules') <> 'off';

-- One row per run: the kind the rules settled on (or why not), the open parts, and whether the
-- description was full_verified.
create view parts_rules.v_gaps with (security_invoker = true) as
select
  r.listing_id, r.evidence_hash, r.rule_version, r.kind, r.kind_gap, r.gaps as parts,
  r.full_verified, r.done_at
from parts_rules.runs r
where switches.state('parts-rules') <> 'off';

-- The tag blocks (keyword stuffing) the rules ignored, by position.
create view parts_rules.v_tag_blocks with (security_invoker = true) as
select
  r.listing_id, r.evidence_hash, r.rule_version, b.source, b."start", b."end", b.rule_id
from parts_rules.runs r
cross join lateral jsonb_to_recordset(r.tag_blocks)
  as b (source text, "start" integer, "end" integer, rule_id text)
where switches.state('parts-rules') <> 'off';

-- The listing-kind signals, with quote and position.
create view parts_rules.v_kind_signals with (security_invoker = true) as
select
  r.listing_id, r.evidence_hash, r.rule_version, s.signal, s.source, s.quote, s."start", s."end",
  s.rule_id
from parts_rules.runs r
cross join lateral jsonb_to_recordset(r.kind_signals)
  as s (signal text, source text, quote text, "start" integer, "end" integer, rule_id text)
where switches.state('parts-rules') <> 'off';

revoke all on parts_rules.v_rule_parts, parts_rules.v_gaps, parts_rules.v_tag_blocks,
  parts_rules.v_kind_signals
  from public, anon, authenticated;
grant select on parts_rules.v_rule_parts, parts_rules.v_gaps, parts_rules.v_tag_blocks,
  parts_rules.v_kind_signals
  to nabvy_pipeline;
