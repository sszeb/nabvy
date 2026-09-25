-- Dated, sourced rate rows (task 4.1g: "each checked against gov.uk before merge";
-- docs/design/drafts/search-map-routes.md §4.2, §4.2 citations [99][100][101]). Rows are never
-- updated: a rate change is a new row with a later effective_from, so a trip already priced still
-- explains itself from the row that held on its own date. The coordinator adds the next quarter's
-- advisory fuel rate as a new migration when it reviews docs/design/modules/travel-cost.md's
-- reminder (1 Mar/Jun/Sep/Dec, packages/config/src/modules/travel-cost.ts).
--
-- Advisory fuel rates: every figure below was read from
-- https://www.gov.uk/guidance/advisory-fuel-rates on 2026-09-25 (page "Last updated 21 August
-- 2026"), exactly as published, for the three quarters the page carries from 1 March 2026. The
-- page's electric rates (7p home, 15p public, by charging location) have no engine band and wait
-- on their own design (services/travel-cost/README.md, "GOV.UK check log").
insert into travel_cost.travel_rates
  (kind, fuel, engine_band, tier, pence_amount, unit, effective_from, source_url)
values
  -- HMRC advisory fuel rates, "From 1 March 2026 to 31 May 2026". Petrol 1,401cc-2,000cc is the
  -- "fuel-only" preset's default rate and the rate the §4.2 worked numbers use.
  ('advisory-fuel-rate', 'petrol', '1400-or-less', '', 12, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'petrol', '1401-2000', '', 14, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'petrol', 'over-2000', '', 22, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', '1600-or-less', '', 12, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', '1601-2000', '', 13, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', 'over-2000', '', 18, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', '1400-or-less', '', 10, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', '1401-2000', '', 12, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', 'over-2000', '', 19, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  -- HMRC advisory fuel rates, "From 1 June 2026 to 31 August 2026".
  ('advisory-fuel-rate', 'petrol', '1400-or-less', '', 14, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'petrol', '1401-2000', '', 17, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'petrol', 'over-2000', '', 26, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', '1600-or-less', '', 15, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', '1601-2000', '', 17, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', 'over-2000', '', 23, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', '1400-or-less', '', 11, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', '1401-2000', '', 13, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', 'over-2000', '', 21, 'mile', '2026-06-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  -- HMRC advisory fuel rates, "From 1 September 2026" (the current quarter on 2026-09-25).
  ('advisory-fuel-rate', 'petrol', '1400-or-less', '', 14, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'petrol', '1401-2000', '', 17, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'petrol', 'over-2000', '', 27, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', '1600-or-less', '', 15, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', '1601-2000', '', 16, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'diesel', 'over-2000', '', 22, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', '1400-or-less', '', 11, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', '1401-2000', '', 13, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  ('advisory-fuel-rate', 'lpg', 'over-2000', '', 20, 'mile', '2026-09-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  -- HMRC approved mileage allowance payment (AMAP), the "HMRC business rate" preset: 55p for the
  -- first 10,000 business miles in the tax year (the rate the §4.2 worked numbers use), 25p after.
  -- Checked 2026-09-25 against the cited page (published 17 June 2026): "increased from 45 pence
  -- per mile to 55 pence per mile ... over 10,000 miles the rate will remain at 25 pence per mile",
  -- "retrospective effect from 6 April 2026". tripCost() prices every trip at the standard tier
  -- for now (no per-user annual-mileage tracking yet); the reduced tier is seeded so the row
  -- exists and is sourced, not invented, once that tracking is built.
  ('approved-mileage-rate', '', '', 'standard', 55, 'mile', '2026-04-06',
   'https://www.gov.uk/government/publications/increase-to-approved-mileage-allowance-payments-amaps-and-self-employed-simplified-mileage-rates/increasing-mileage-rates'),
  ('approved-mileage-rate', '', '', 'reduced', 25, 'mile', '2026-04-06',
   'https://www.gov.uk/government/publications/increase-to-approved-mileage-allowance-payments-amaps-and-self-employed-simplified-mileage-rates/increasing-mileage-rates'),
  -- The default value of time: the National Living Wage (21 and over), an hourly figure a user
  -- can override (down to £0, "don't count my time"). Checked 2026-09-25 against the cited page:
  -- "21 and over, April 2026, £12.71".
  ('value-of-time', '', '', '', 1271, 'hour', '2026-04-01',
   'https://www.gov.uk/national-minimum-wage-rates')
on conflict (kind, fuel, engine_band, tier, effective_from) do nothing;
