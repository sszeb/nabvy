-- Dated, sourced rate rows (task 4.1g: "each checked against gov.uk before merge";
-- docs/design/drafts/search-map-routes.md §4.2, §4.2 citations [99][100][101]). Rows are never
-- updated: a rate change is a new row with a later effective_from, so a trip already priced still
-- explains itself from the row that held on its own date. The coordinator adds the next quarter's
-- advisory fuel rate as a new migration when it reviews docs/design/modules/travel-cost.md's
-- reminder (1 Mar/Jun/Sep/Dec, packages/config/src/modules/travel-cost.ts).
insert into travel_cost.travel_rates
  (kind, fuel, engine_band, tier, pence_amount, unit, effective_from, source_url)
values
  -- HMRC advisory fuel rate, 1,401cc-2,000cc petrol: fuel cost only, the "fuel-only" preset's
  -- default rate.
  ('advisory-fuel-rate', 'petrol', '1401-2000', '', 14, 'mile', '2026-03-01',
   'https://www.gov.uk/guidance/advisory-fuel-rates'),
  -- HMRC approved mileage allowance payment (AMAP), the "HMRC business rate" preset: 55p for the
  -- first 10,000 business miles in the tax year (the rate the §4.2 worked numbers use), 25p after.
  -- tripCost() prices every trip at the standard tier for now (no per-user annual-mileage
  -- tracking yet); the reduced tier is seeded so the row exists and is sourced, not invented,
  -- once that tracking is built.
  ('approved-mileage-rate', '', '', 'standard', 55, 'mile', '2026-04-06',
   'https://www.gov.uk/government/publications/increase-to-approved-mileage-allowance-payments-amaps-and-self-employed-simplified-mileage-rates/increasing-mileage-rates'),
  ('approved-mileage-rate', '', '', 'reduced', 25, 'mile', '2026-04-06',
   'https://www.gov.uk/government/publications/increase-to-approved-mileage-allowance-payments-amaps-and-self-employed-simplified-mileage-rates/increasing-mileage-rates'),
  -- The default value of time: the National Living Wage, an hourly figure a user can override
  -- (down to £0, "don't count my time").
  ('value-of-time', '', '', '', 1271, 'hour', '2026-04-01',
   'https://www.gov.uk/national-minimum-wage-rates')
on conflict (kind, fuel, engine_band, tier, effective_from) do nothing;
