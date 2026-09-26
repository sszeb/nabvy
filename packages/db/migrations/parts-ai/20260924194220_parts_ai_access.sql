-- Access and views for the parts_ai schema (packages/db/README.md, "Adding tables to a module";
-- services/parts-ai/README.md). Depends on core (track_updated_at) and switches
-- (switches.state). The module reads detail-evidence's, parts-rules' and product-catalogue's
-- views and calls cost-meter, spend-governor, details-queue and quote-redaction from its code,
-- not from these views, so module.json lists them for apply order only.
--
-- Model calls and their checked output are pipeline data with no user rows, so there is no
-- user_id and no RLS, as in parts_rules. Only the pipeline role (nabvy_pipeline; per-module
-- roles are question 2 of the catalogue) reads and writes the tables, with the least it needs:
-- rows are inserted once and never rewritten, except a reviewer's correction beside an AI part;
-- delete only for erase() (rule 12: seller-rights erasure). nabvy_app gets nothing: the module
-- publishes no user-facing view.

grant usage on schema parts_ai to nabvy_pipeline;
grant select, insert, delete on parts_ai.calls, parts_ai.ai_parts, parts_ai.quarantine,
  parts_ai.refreshes to nabvy_pipeline;
grant update (correction) on parts_ai.ai_parts to nabvy_pipeline;

select nabvy_core.track_updated_at('parts_ai.ai_parts');

-- Internal views: security_invoker, explicit columns, never a seller field (no prompt carries
-- one), no cost (cost-meter's v_costs holds it). Empty while the module's switch is off
-- (rule 11); shadow and on show rows.

-- Every AI part, after its quote was found in the stored text and its product resolved.
create view parts_ai.v_ai_parts with (security_invoker = true) as
select
  p.listing_id, p.evidence_hash, p.prompt_version, p.seq, p.part_type, p.catalogue_id, p.family,
  p.inclusion, p.source, p.quote, p.quote_start as "start", p.quote_end as "end", p.correction
from parts_ai.ai_parts p
where switches.state('parts-ai') <> 'off';

-- One row per call: extracted or quarantined, and the listing kind the model read.
create view parts_ai.v_runs with (security_invoker = true) as
select
  c.listing_id, c.evidence_hash, c.prompt_version, c.status, c.kind, c.kind_source, c.kind_quote,
  c.kind_start, c.kind_end, c.done_at
from parts_ai.calls c
where switches.state('parts-ai') <> 'off';

-- Quarantined calls and why (this module's own text, never the model's output).
create view parts_ai.v_quarantine with (security_invoker = true) as
select q.listing_id, q.evidence_hash, q.prompt_version, q.problem, q.detail, q.at
from parts_ai.quarantine q
where switches.state('parts-ai') <> 'off';

revoke all on parts_ai.v_ai_parts, parts_ai.v_runs, parts_ai.v_quarantine
  from public, anon, authenticated;
grant select on parts_ai.v_ai_parts, parts_ai.v_runs, parts_ai.v_quarantine to nabvy_pipeline;
