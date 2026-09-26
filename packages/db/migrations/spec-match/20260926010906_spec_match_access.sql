-- Access and views for the spec_match schema (packages/db/README.md, "Adding tables to a module";
-- services/spec-match/README.md). Depends on core (track_updated_at, enable_user_rls,
-- allow_pipeline, current_user_id), switches (switches.state, switches.is_on), listing-suppression
-- (is_suppressed, for the user-facing view) and quote-redaction (quote, for the user-facing view).
-- The module reads want-manager's, parts-record's, listing-assessment's, noise-filter's,
-- listing-ingest's and copy-advert's views from its code, not from these views, so module.json
-- lists them for apply order only.
--
-- Only the pipeline role writes matches, with the least it needs: a new input is a new row, and a
-- row is never rewritten except its matched_at, when a pair's inputs return to an earlier state
-- and that row becomes the latest again; delete for erase() (rule 12: seller-rights erasure), for
-- a deleted want and for the account.deleted purge. nabvy_app reads only its own rows (user_id),
-- through app.v_spec_match_results, with column-level select on the columns that view reads and
-- a restrictive policy that shows exactly the rows the view may show.

comment on schema spec_match is
  'Spec match: wants matched against listings by the parts they contain. Owner: the spec-match module.';

grant usage on schema spec_match to nabvy_pipeline;
grant select, insert, delete on spec_match.matches to nabvy_pipeline;
grant update (matched_at) on spec_match.matches to nabvy_pipeline;

select nabvy_core.track_updated_at('spec_match.matches');
select nabvy_core.enable_user_rls('spec_match.matches');
select nabvy_core.allow_pipeline('spec_match.matches', 'all');

-- Internal view: security_invoker, explicit columns, no user ID and never a seller field (no
-- input carries one). The latest verdict of each want and listing: the row with the latest
-- matched_at (then the latest id). Quotes are the stored ones, verbatim from parts-record and
-- listing-assessment; readers that show them to a user pass them through quote-redaction. Empty
-- while the module's switch is off (rule 11); shadow and on show rows.
create view spec_match.v_matches with (security_invoker = true) as
select
  m.id as match_id, m.want_id, m.listing_id, m.evidence_hash, m.card_hash, m.input_hash,
  m.rule_version, m.verdict, m.criteria, m.inside_pc, m.origin, m.backfill, m.matched_at
from (
  select distinct on (x.want_id, x.listing_id)
    x.id, x.want_id, x.listing_id, x.evidence_hash, x.card_hash, x.input_hash, x.rule_version,
    x.verdict, x.criteria, x.inside_pc, x.origin, x.backfill, x.matched_at
  from spec_match.matches x
  order by x.want_id, x.listing_id, x.matched_at desc, x.id desc
) m
where switches.state('spec-match') <> 'off';

revoke all on spec_match.v_matches from public, anon, authenticated;
grant select on spec_match.v_matches to nabvy_pipeline;

-- The user-facing view (rule 5; docs/security.md, "Cross-module reads behind a user-facing
-- view"). It reads only this module's own table; the cross-module calls are the SECURITY DEFINER
-- predicate listing_suppression.is_suppressed(), the switches functions and
-- quote_redaction.quote(), all granted to nabvy_app. security_invoker, so the table's row-level
-- security limits it to the caller's own rows (withUser). One row per want and listing: its
-- latest verdict, only when that is not no_match. Every evidence quote passes
-- quote_redaction.quote(): masked while that module is on, null while it is off (fail closed).
-- Rows only while this module is on (off or shadow: no rows), only while listing-suppression is
-- on, never a suppressed listing. No hash, no user ID, no seller field, no full description.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to nabvy_app;

create view app.v_spec_match_results with (security_invoker = true) as
select
  m.id as match_id, m.want_id, m.listing_id, m.verdict, m.inside_pc, m.origin, m.backfill,
  (
    select coalesce(jsonb_agg(
      jsonb_set(c.value, '{evidence}', (
        select coalesce(jsonb_agg(
          jsonb_set(e.value, '{quote}',
            coalesce(to_jsonb(quote_redaction.quote(e.value ->> 'quote')), 'null'::jsonb))
          order by e.ordinality), '[]'::jsonb)
        from jsonb_array_elements(coalesce(c.value -> 'evidence', '[]'::jsonb))
          with ordinality as e (value, ordinality)
      ))
      order by c.ordinality), '[]'::jsonb)
    from jsonb_array_elements(m.criteria) with ordinality as c (value, ordinality)
  ) as criteria,
  m.matched_at
from (
  select distinct on (x.want_id, x.listing_id)
    x.id, x.want_id, x.listing_id, x.verdict, x.inside_pc, x.origin, x.backfill, x.criteria,
    x.matched_at
  from spec_match.matches x
  order by x.want_id, x.listing_id, x.matched_at desc, x.id desc
) m
where switches.is_on('spec-match')
  and switches.is_on('listing-suppression')
  and m.verdict <> 'no_match'
  and not listing_suppression.is_suppressed(m.listing_id);

revoke all on app.v_spec_match_results from public, anon, authenticated;
grant select on app.v_spec_match_results to nabvy_app;

-- The table behind a security_invoker view must be readable by the view's reader: nabvy_app gets
-- column-level select on exactly the columns the view and its policies read (never the hashes or
-- the rule version, never the raw criteria which contains unredacted quotes), user_isolation
-- (enable_user_rls above) gives it only its own rows, and a restrictive policy adds the view's own
-- conditions, so a direct read of the table by the app role sees no more than the view. The
-- pipeline role keeps every row through allow_pipeline. The app role does not need direct access
-- to criteria because app.v_spec_match_results is security_invoker and redacts criteria in its
-- query; a direct table read by the app role should see neither no_match verdicts nor raw quotes.
grant usage on schema spec_match to nabvy_app;
grant select (id, want_id, user_id, listing_id, verdict, inside_pc, origin, backfill,
  matched_at) on spec_match.matches to nabvy_app;
create policy app_user_facing on spec_match.matches as restrictive for select to nabvy_app
  using (switches.is_on('spec-match') and switches.is_on('listing-suppression')
         and verdict <> 'no_match'
         and not listing_suppression.is_suppressed(listing_id));
