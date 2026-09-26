-- Access and views for the warning_signs schema (packages/db/README.md, "Adding tables to a
-- module"; services/warning-signs/README.md). Depends on core (track_updated_at, allow_pipeline),
-- switches (switches.state, switches.is_on), listing-suppression (is_suppressed, for the
-- user-facing view) and quote-redaction (quote, for the user-facing evidence text). The module
-- reads listing-ingest's, detail-evidence's, listing-assessment's and asking-price-index's views
-- from its code, not from these views, so module.json lists them for apply order only.
--
-- Evaluations and facts are pipeline data with no user rows, so there is no user_id. Only the
-- pipeline role writes, with the least it needs: a new input is a new evaluation and new facts;
-- a fact is never rewritten, and an evaluation only has its evaluated_at moved forward when
-- inputs return to an earlier state; delete only for erase() (rule 12: seller-rights erasure).
-- nabvy_app gets select on app.v_warning_signs, and column-level select on the columns that view
-- reads, behind row-level policies that show exactly the rows the view may show.

grant usage on schema warning_signs to nabvy_pipeline;
grant select, insert, delete on warning_signs.evaluations to nabvy_pipeline;
grant update (evaluated_at) on warning_signs.evaluations to nabvy_pipeline;
grant select, insert, delete on warning_signs.facts to nabvy_pipeline;

select nabvy_core.track_updated_at('warning_signs.evaluations');
select nabvy_core.track_updated_at('warning_signs.facts');
select nabvy_core.allow_pipeline('warning_signs.evaluations', 'all');
select nabvy_core.allow_pipeline('warning_signs.facts', 'all');

-- Internal view: security_invoker, explicit columns, never a seller field (no input carries
-- one). The facts of each listing's latest evaluation: the evaluation with the latest
-- evaluated_at (then the latest id), so an evaluation that finds nothing shows nothing. Every
-- code, internal ones included (stock phrasing, the too-good-to-be-true support and counter
-- signals, price facts). Empty while the module's switch is off (rule 11); shadow and on show
-- rows.
create view warning_signs.v_facts with (security_invoker = true) as
select
  f.listing_id, f.evidence_hash, f.card_hash, e.input_hash, f.code, f.reason, f.evidence,
  f.rule_id, f.rule_version, e.fetched_at, f.found_at
from (
  select distinct on (x.listing_id) x.id, x.input_hash, x.fetched_at
  from warning_signs.evaluations x
  order by x.listing_id, x.evaluated_at desc, x.id desc
) e
join warning_signs.facts f on f.evaluation_id = e.id
where switches.state('warning-signs') <> 'off';

revoke all on warning_signs.v_facts from public, anon, authenticated;
grant select on warning_signs.v_facts to nabvy_pipeline;

-- The user-facing view (rule 5; docs/security.md, "Cross-module reads behind a user-facing
-- view"). It reads only this module's own tables; the cross-module calls are
-- listing_suppression.is_suppressed(), the SECURITY DEFINER predicate granted to nabvy_app, and
-- quote_redaction.quote(), a function granted to nabvy_app that masks contact details and
-- returns null while quote-redaction is not on (fail closed: no quote, the fact still shows).
-- Schema app is created idempotently and closed to public; nabvy_app may use it. Rows appear only
-- while this module is on (off or shadow: no rows), only while listing-suppression is on (an off
-- or unreachable suppression module hides every listing), and never for a suppressed listing.
-- Only the user-facing codes (packages/config/src/modules/warning-signs.ts `userFacingCodes`; a
-- test compares the lists). No reason, rule, hash or number, no seller field.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to nabvy_app;

create view app.v_warning_signs with (security_invoker = true) as
select f.listing_id, f.code, quote_redaction.quote(f.evidence_text) as evidence_text
from (
  select distinct on (x.listing_id) x.id
  from warning_signs.evaluations x
  order by x.listing_id, x.evaluated_at desc, x.id desc
) e
join warning_signs.facts f on f.evaluation_id = e.id
where switches.is_on('warning-signs')
  and switches.is_on('listing-suppression')
  and f.code in ('pay_first_text', 'box_only', 'mining_text', 'untested_text', 'not_working_text')
  and not listing_suppression.is_suppressed(f.listing_id);

revoke all on app.v_warning_signs from public, anon, authenticated;
grant select on app.v_warning_signs to nabvy_app;

-- The tables behind a security_invoker view must be readable by the view's reader: nabvy_app
-- gets column-level select on exactly the columns the view reads (never evidence, reasons,
-- hashes or rule columns), and row-level security gives it exactly the rows the view may show,
-- so a direct read of the tables by the app role sees no more than the view (rows only while
-- this module and listing-suppression are on, never a suppressed listing, facts of user-facing
-- codes only). The pipeline role keeps every row through allow_pipeline above.
grant usage on schema warning_signs to nabvy_app;
grant select (id, listing_id, evaluated_at) on warning_signs.evaluations to nabvy_app;
grant select (evaluation_id, listing_id, code, evidence_text) on warning_signs.facts to nabvy_app;
create policy app_user_facing on warning_signs.evaluations for select to nabvy_app
  using (switches.is_on('warning-signs') and switches.is_on('listing-suppression')
         and not listing_suppression.is_suppressed(listing_id));
create policy app_user_facing on warning_signs.facts for select to nabvy_app
  using (switches.is_on('warning-signs') and switches.is_on('listing-suppression')
         and code in ('pay_first_text', 'box_only', 'mining_text', 'untested_text', 'not_working_text')
         and not listing_suppression.is_suppressed(listing_id));
