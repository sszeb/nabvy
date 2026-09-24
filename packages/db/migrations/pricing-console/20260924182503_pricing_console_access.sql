-- pricing-console: grants, row-level security, the append-only guard, the measured-cost reader,
-- the internal views and the initial policy values. Hand-written (packages/db/README.md).
--
-- Invariants the database holds whoever writes (services/pricing-console/README.md, "Tables"):
--   * policy rows are append-only: nobody updates them; a change is the next version of its
--     (kind, key), numbered without gaps; only an offer made for one user may be deleted (the
--     account-deletion purge);
--   * a version never takes effect in the past;
--   * the web app reads prices, never writes them, and sees an offer only if it is for everyone,
--     for a segment, or for the signed-in user;
--   * only the pipeline writes (the admin procedure, once built, calls the module inside
--     withPipeline after checking the admin role; README.md, "Inputs").
comment on schema pricing_console is
  'Pricing console: the price policy as versioned rows (ladder, unit prices, bundles, offers, free tier, settings, cost bases). Owner: the pricing-console module.';
grant usage on schema pricing_console to nabvy_app, nabvy_pipeline;

alter table pricing_console.policy_rows enable row level security;
create policy app_reads_prices on pricing_console.policy_rows for select to nabvy_app
  using (target_user_id is null or target_user_id = nabvy_core.current_user_id());
grant select on pricing_console.policy_rows to nabvy_app;
select nabvy_core.allow_pipeline('pricing_console.policy_rows', 'select');
select nabvy_core.allow_pipeline('pricing_console.policy_rows', 'insert');
select nabvy_core.allow_pipeline('pricing_console.policy_rows', 'delete');
grant select, insert, delete on pricing_console.policy_rows to nabvy_pipeline;

create or replace function pricing_console.guard_policy_rows() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  latest integer;
begin
  if tg_op = 'UPDATE' then
    raise exception 'pricing_console.policy_rows is append-only: write the next version instead'
      using errcode = 'insufficient_privilege';
  elsif tg_op = 'DELETE' then
    if old.target_user_id is null then
      raise exception 'pricing_console.policy_rows: only an offer made for one user may be deleted'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  select max(r.version) into latest
  from pricing_console.policy_rows as r
  where r.kind = new.kind and r.key = new.key;
  if new.version <> coalesce(latest, 0) + 1 then
    raise exception 'pricing_console.policy_rows: % % needs version %, not %',
      new.kind, new.key, coalesce(latest, 0) + 1, new.version
      using errcode = 'check_violation';
  end if;
  -- effective_at keeps milliseconds (rounded), so compare with now() truncated to them.
  if new.effective_at < date_trunc('milliseconds', now()) then
    raise exception 'pricing_console.policy_rows: a version cannot take effect in the past'
      using errcode = 'check_violation';
  end if;
  if new.target_user_id is distinct from
     (case when new.kind = 'offer' then (new.value ->> 'userId')::uuid end) then
    raise exception 'pricing_console.policy_rows: target_user_id must be the offer''s userId'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger policy_rows_guard before insert or update or delete on pricing_console.policy_rows
  for each row execute function pricing_console.guard_policy_rows();

create or replace function pricing_console.refuse_truncate() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'pricing_console.policy_rows cannot be truncated'
    using errcode = 'insufficient_privilege';
end;
$$;
create trigger policy_rows_no_truncate before truncate on pricing_console.policy_rows
  for each statement execute function pricing_console.refuse_truncate();

-- Measured cost for the floor: the mean cost of matching calls in cost_meter.v_costs over the
-- window, or null until there are enough of them. SECURITY DEFINER so the web app can price an
-- action (it has no grant on v_costs); it returns one aggregate, never a call.
create or replace function pricing_console.measured_cost(
  p_provider text,
  p_module text,
  p_window_days integer,
  p_min_samples integer
) returns bigint
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select case when count(*) >= p_min_samples then ceil(avg(c.counted_gbp_micros))::bigint end
  from cost_meter.v_costs as c
  where c.provider = p_provider
    and (p_module is null or c.module = p_module)
    and c.at > now() - make_interval(days => p_window_days)
$$;
revoke all on function pricing_console.measured_cost(text, text, integer, integer) from public;
grant execute on function pricing_console.measured_cost(text, text, integer, integer)
  to nabvy_app, nabvy_pipeline;

-- The current row of each (kind, key): its highest version already in effect, unless retired.
create view pricing_console.current_rows with (security_invoker = true) as
  select c.id, c.kind, c.key, c.version, c.value, c.target_user_id, c.effective_at
  from (
    select distinct on (r.kind, r.key) r.*
    from pricing_console.policy_rows as r
    where r.effective_at <= now()
    order by r.kind, r.key, r.version desc
  ) as c
  where not c.retired;
revoke all on pricing_console.current_rows from public;
grant select on pricing_console.current_rows to nabvy_pipeline;

-- The views below always return their rows, whatever the module's switch (README.md, "Switch and
-- priority": when off, list prices apply), except v_offers: no offers while the module is off.
create view pricing_console.v_ladder with (security_invoker = true) as
  select c.key as tier,
         c.version,
         (c.value ->> 'baseCadenceMinutes')::integer as base_cadence_minutes,
         (c.value ->> 'floorCadenceMinutes')::integer as floor_cadence_minutes,
         (c.value ->> 'bundledCredits')::integer as bundled_credits,
         (c.value ->> 'monthlyPriceMinor')::integer as monthly_price_minor,
         (c.value ->> 'yearlyPriceMinor')::integer as yearly_price_minor,
         (c.value ->> 'topupGrossMicrosPerCredit')::integer as topup_gross_micros_per_credit,
         (c.value ->> 'topupNetMicrosPerCredit')::integer as topup_net_micros_per_credit,
         (c.value ->> 'areas')::integer as areas,
         (c.value ->> 'wants')::integer as wants,
         (c.value ->> 'roundTheClock')::boolean as round_the_clock,
         c.effective_at
  from pricing_console.current_rows as c
  where c.kind = 'tier';

create view pricing_console.v_prices with (security_invoker = true) as
  select c.key as item,
         c.version,
         c.value ->> 'unit' as unit,
         (c.value ->> 'credits')::integer as credits,
         (c.value ->> 'cadenceMinutes')::integer as cadence_minutes,
         c.value ->> 'costBasis' as cost_basis,
         (c.value ->> 'costUnits')::integer as cost_units,
         c.effective_at
  from pricing_console.current_rows as c
  where c.kind = 'price';

create view pricing_console.v_offers with (security_invoker = true) as
  select o.offer, o.version, o.user_id, o.segment, o.item, o.discount_bps, o.starts_at, o.ends_at
  from (
    select c.key as offer,
           c.version,
           c.target_user_id as user_id,
           c.value ->> 'segment' as segment,
           c.value ->> 'item' as item,
           (c.value ->> 'discountBps')::integer as discount_bps,
           (c.value ->> 'startsAt')::timestamptz as starts_at,
           (c.value ->> 'endsAt')::timestamptz as ends_at
    from pricing_console.current_rows as c
    where c.kind = 'offer'
  ) as o
  where o.starts_at <= now() and o.ends_at > now()
    and switches.state('pricing-console') <> 'off';

create view pricing_console.v_free_policy with (security_invoker = true) as
  select c.version,
         (c.value ->> 'wantCount')::integer as want_count,
         (c.value ->> 'windowCount')::integer as window_count,
         (c.value ->> 'windowMinutes')::integer as window_minutes,
         (c.value ->> 'resetHours')::integer as reset_hours,
         c.value -> 'bursts' as bursts,
         (c.value ->> 'lifetimeCapPence')::integer as lifetime_cap_pence,
         (c.value ->> 'userWeekCapPence')::integer as user_week_cap_pence,
         (c.value ->> 'userMonthCapPence')::integer as user_month_cap_pence,
         (c.value ->> 'poolDayFloorPence')::integer as pool_day_floor_pence,
         (c.value ->> 'poolRevenueShareBps')::integer as pool_revenue_share_bps,
         (c.value ->> 'poolWeekPence')::integer as pool_week_pence,
         (c.value ->> 'poolMonthPence')::integer as pool_month_pence,
         (c.value ->> 'signupsPerIpDay')::integer as signups_per_ip_day,
         (c.value ->> 'signupsPerDeviceDay')::integer as signups_per_device_day,
         (c.value ->> 'signupsPerEmailDomainDay')::integer as signups_per_email_domain_day,
         c.effective_at
  from pricing_console.current_rows as c
  where c.kind = 'free-tier' and c.key = 'default';

create view pricing_console.v_settings with (security_invoker = true) as
  select c.key as setting, c.version, (c.value ->> 'value')::integer as value, c.effective_at
  from pricing_console.current_rows as c
  where c.kind = 'setting';

revoke all on pricing_console.v_ladder, pricing_console.v_prices, pricing_console.v_offers,
  pricing_console.v_free_policy, pricing_console.v_settings from public;
grant select on pricing_console.v_ladder, pricing_console.v_prices, pricing_console.v_offers,
  pricing_console.v_free_policy, pricing_console.v_settings to nabvy_pipeline;

-- Initial policy values (README.md, "Rules and thresholds", with their sources). Not owner
-- decisions: tier prices are placeholders from docs/design/pricing-model.md until the owner
-- confirms them; the ladder's cadences and credits are coordinator 6's table of 17:40 in
-- docs/decisions.md, "Paid ladder"; the free tier is the coordinator's shape of 16:50 in
-- "Free tier: bursts under a lifetime cap". An admin changes any of them with a new version.
insert into pricing_console.policy_rows (kind, key, version, value, reason) values
  ('setting', 'min-margin-bps', 1, '{"value": 20000}',
   'initial policy value: the floor sells at no less than 2x measured cost (brief: start at two to three times)'),
  ('setting', 'vat-bps', 1, '{"value": 2000}',
   'initial policy value: prices include 20% VAT (pricing-model, Unit economics)'),
  ('setting', 'payment-fee-bps', 1, '{"value": 270}',
   'initial policy value: card 1.5% + Billing 0.7% + Tax 0.5% (pricing-model, Unit economics, [A] verify)'),
  ('setting', 'payment-fee-fixed-minor', 1, '{"value": 20}',
   'initial policy value: 20p per payment (pricing-model, Unit economics, [A] verify)'),
  ('setting', 'round-the-clock-bps', 1, '{"value": 15000}',
   'initial policy value: round the clock x1.5 (pricing-model, Unit prices)'),
  ('cost-basis', 'check', 1,
   '{"provider": "apify", "module": null, "fallbackGbpMicros": 13100, "windowDays": 7, "minSamples": 20}',
   'initial policy value: 1.31p per lone check, measured (decisions, Free tier 16:50)'),
  ('cost-basis', 'photo-scan', 1,
   '{"provider": "anthropic", "module": "scan-recognition", "fallbackGbpMicros": 20000, "windowDays": 7, "minSamples": 20}',
   'initial policy value: 2p per photo scan (pricing-model, Unit prices, [P])'),
  ('tier', 'starter', 1,
   '{"baseCadenceMinutes": 120, "floorCadenceMinutes": 60, "bundledCredits": 1200, "monthlyPriceMinor": 1200, "yearlyPriceMinor": 12000, "topupGrossMicrosPerCredit": 10000, "topupNetMicrosPerCredit": 7900, "areas": 2, "wants": 10, "roundTheClock": false}',
   'initial policy value: cadences and credits from decisions, Paid ladder (17:40); price placeholder from pricing-model'),
  ('tier', 'pro', 1,
   '{"baseCadenceMinutes": 30, "floorCadenceMinutes": 5, "bundledCredits": 6000, "monthlyPriceMinor": 2900, "yearlyPriceMinor": 29000, "topupGrossMicrosPerCredit": 4830, "topupNetMicrosPerCredit": 3860, "areas": 6, "wants": 40, "roundTheClock": false}',
   'initial policy value: cadences and credits from decisions, Paid ladder (17:40); price placeholder from pricing-model'),
  ('tier', 'max', 1,
   '{"baseCadenceMinutes": 15, "floorCadenceMinutes": 1, "bundledCredits": 24000, "monthlyPriceMinor": 9900, "yearlyPriceMinor": 99000, "topupGrossMicrosPerCredit": 4130, "topupNetMicrosPerCredit": 3320, "areas": 20, "wants": 150, "roundTheClock": false}',
   'initial policy value: cadences and credits from decisions, Paid ladder (17:40); price placeholder from pricing-model'),
  ('tier', 'business', 1,
   '{"baseCadenceMinutes": 15, "floorCadenceMinutes": 1, "bundledCredits": 80000, "monthlyPriceMinor": 29900, "yearlyPriceMinor": null, "topupGrossMicrosPerCredit": 3740, "topupNetMicrosPerCredit": 3010, "areas": 60, "wants": 150, "roundTheClock": true}',
   'initial policy value: cadences and credits from decisions, Paid ladder (17:40); price placeholder from pricing-model; wants question'),
  ('price', 'photo-scan', 1, '{"unit": "each", "credits": 15, "costBasis": "photo-scan", "costUnits": 1}',
   'initial policy value: pricing-model, Unit prices (Checking)'),
  ('price', 'live-lookup', 1, '{"unit": "each", "credits": 15, "costBasis": "check", "costUnits": 1}',
   'initial policy value: pricing-model, Unit prices (Checking), per source checked'),
  ('price', 'pasted-link', 1, '{"unit": "each", "credits": 10, "costBasis": "check", "costUnits": 1}',
   'initial policy value: pricing-model, Unit prices (Checking)'),
  ('price', 'similar-item', 1, '{"unit": "each", "credits": 10, "costBasis": "check", "costUnits": 1}',
   'initial policy value: pricing-model, Unit prices (Checking)'),
  ('price', 'export', 1, '{"unit": "each", "credits": 50, "costBasis": null, "costUnits": 1}',
   'initial policy value: pricing-model, Unit prices (Checking)'),
  ('price', 'boost-24h', 1, '{"unit": "each", "credits": 150, "costBasis": null, "costUnits": 1}',
   'initial policy value: pricing-model, Unit prices (Checking)'),
  ('price', 'boost-7d', 1, '{"unit": "each", "credits": 500, "costBasis": null, "costUnits": 1}',
   'initial policy value: pricing-model, Unit prices (Checking)'),
  ('price', 'watch-60', 1, '{"unit": "area-month", "credits": 300, "cadenceMinutes": 60}',
   'initial policy value: pricing-model, Unit prices (Watching)'),
  ('price', 'watch-15', 1, '{"unit": "area-month", "credits": 900, "cadenceMinutes": 15}',
   'initial policy value: pricing-model, Unit prices (Watching)'),
  ('price', 'watch-5', 1, '{"unit": "area-month", "credits": 2000, "cadenceMinutes": 5}',
   'initial policy value: pricing-model, Unit prices (Watching)'),
  ('price', 'watch-1', 1, '{"unit": "area-month", "credits": 6000, "cadenceMinutes": 1}',
   'initial policy value: pricing-model, Unit prices (Watching)'),
  ('bundle', 'topup-10', 1, '{"tier": null, "grossMinor": 1000, "discountBps": 0}',
   'initial policy value: top-ups of 10, 25 and 50 pounds at the tier''s rate (pricing-model, Rules)'),
  ('bundle', 'topup-25', 1, '{"tier": null, "grossMinor": 2500, "discountBps": 0}',
   'initial policy value: top-ups of 10, 25 and 50 pounds at the tier''s rate (pricing-model, Rules)'),
  ('bundle', 'topup-50', 1, '{"tier": null, "grossMinor": 5000, "discountBps": 0}',
   'initial policy value: top-ups of 10, 25 and 50 pounds at the tier''s rate (pricing-model, Rules)'),
  ('free-tier', 'default', 1,
   '{"wantCount": 1, "windowCount": 3, "windowMinutes": 480, "resetHours": 72, "bursts": [[{"cadenceMinutes": 1, "minutes": 20}, {"cadenceMinutes": 5, "minutes": 100}, {"cadenceMinutes": 15, "minutes": 120}, {"cadenceMinutes": 60, "minutes": 240}], [{"cadenceMinutes": 1, "minutes": 10}, {"cadenceMinutes": 5, "minutes": 50}, {"cadenceMinutes": 15, "minutes": 120}, {"cadenceMinutes": 60, "minutes": 300}]], "lifetimeCapPence": 200, "userWeekCapPence": null, "userMonthCapPence": null, "poolDayFloorPence": 2000, "poolRevenueShareBps": 500, "poolWeekPence": null, "poolMonthPence": null, "signupsPerIpDay": null, "signupsPerDeviceDay": null, "signupsPerEmailDomainDay": null}',
   'initial policy value: coordinator''s shape of 16:50 (decisions, Free tier: bursts under a lifetime cap)');
