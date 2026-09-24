-- Access, the published views and the owner's budgets for the spend-governor module.
-- Hand-written (drizzle-kit --custom). services/spend-governor/README.md has the rules.

-- Only the pipeline uses the governor: it recomputes the throttle, and paying modules
-- (check-scheduler, details-queue, model callers) read v_throttle before they spend. Never granted
-- to anon, authenticated or nabvy_app: users never see budgets or costs.
grant usage on schema spend_governor to nabvy_pipeline;

-- Budgets are owner decisions: set by migrations only, read by the pipeline.
grant select on spend_governor.budgets to nabvy_pipeline;
select nabvy_core.allow_pipeline('spend_governor.budgets', 'select');
select nabvy_core.track_updated_at('spend_governor.budgets');

-- The recompute writes one row per budget. No delete: a budget's row is overwritten, never removed.
grant select, insert, update on spend_governor.throttle to nabvy_pipeline;
select nabvy_core.allow_pipeline('spend_governor.throttle', 'select');
select nabvy_core.allow_pipeline('spend_governor.throttle', 'insert');
select nabvy_core.allow_pipeline('spend_governor.throttle', 'update');
select nabvy_core.track_updated_at('spend_governor.throttle');

-- Where each budget stands (SpendGovernorBudget). Internal: no rows while the module is off
-- (rule 11 of docs/design/modules/_rules.md).
create view spend_governor.v_budgets with (security_invoker = true) as
  select b.name, b.provider, b.unit, b.period, b.limit_micros,
         t.committed_micros,
         b.limit_micros - t.committed_micros as remaining_micros,
         t.forecast_micros, t.level, t.period_start, t.computed_at, b.set_by
  from spend_governor.budgets b
  left join spend_governor.throttle t on t.budget = b.name
  where switches.state('spend-governor') <> 'off';
grant select on spend_governor.v_budgets to nabvy_pipeline;

-- The level each budget imposes (SpendGovernorThrottle). Fails closed: unlike other internal
-- views it keeps one row per budget while the module is off, reading `hold-new`, because an empty
-- throttle would read as "no throttle" (rule 11: if cost-meter or spend-governor is off, paid work
-- pauses). A budget never computed, or whose last recompute is past valid_until, also reads
-- `hold-new`. A budget that cannot be measured yet (committed_micros null) reads its computed
-- level, `none`, with reason `unmeasured`.
create view spend_governor.v_throttle with (security_invoker = true) as
  with g as (
    select switches.state('spend-governor') <> 'off'
       and switches.state('cost-meter') <> 'off' as governing
  )
  select b.name as budget,
         case
           when not g.governing or t.budget is null or t.valid_until <= now() then 'hold-new'
           else t.level
         end as level,
         case
           when not g.governing then 'off'
           when t.budget is null then 'never-computed'
           when t.valid_until <= now() then 'stale'
           when t.committed_micros is null then 'unmeasured'
           else 'computed'
         end as reason,
         t.since, t.computed_at
  from spend_governor.budgets b
  cross join g
  left join spend_governor.throttle t on t.budget = b.name;
grant select on spend_governor.v_throttle to nabvy_pipeline;

-- The owner's budgets. Limits in integer micros: $150 is 150 000 000 USD micros, 10 GB is
-- 10 000 000 micro-GB. Periods are calendar months in Europe/London, as the gateway's cap.
insert into spend_governor.budgets (name, provider, unit, period, limit_micros, set_by) values
  ('apify-monthly', 'apify', 'USD', 'month', 150000000,
   'Owner, 2026-09-24: an Apify budget of $150 a month (docs/decisions.md, "Beta coverage and Apify budget"). The hard cap stays in apify-gateway.'),
  ('apify-plan-usage', 'apify', 'USD', 'month', 85000000,
   'Working ceiling: the Apify account''s recorded plan cap of $85 a month (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:321-322; actor-integration.md 2.12, question 19).'),
  ('apify-residential-proxy', 'apify', 'GB', 'month', 10000000,
   'Working ceiling: the Apify account''s recorded 10 GB of residential proxy (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:321-322; actor-integration.md 2.12, question 19).')
on conflict (name) do nothing;
