# Open questions — travel-cost module

Same format as `docs/questions.md` (date, task, question, option taken and why), kept in its own
file per module so parallel build sessions never conflict appending to the shared one
(`docs/session-conventions.md`). The coordinator folds these into `docs/questions.md` at a
check-in.

- **2026-09-25, w1 travel-cost: electric advisory rate.** GOV.UK's advisory-fuel-rates page
  (read 2026-09-25, last updated 21 August 2026) publishes an advisory electric rate keyed by
  charging location (7p per mile home charger, 15p public charger from 1 Sep 2026), not by engine
  band, so it does not fit the `travel_rates` (kind, fuel, engine_band) shape and a user who picks
  `fuel: 'electric'` on the `fuel-only` preset gets `travel-cost.no_rate` today. Option taken: not
  seeded and not designed in this PR, as both reviews asked; the conservative choice is to refuse
  rather than pick one of the two locations for the user. Needed from the owner: whether electric
  users choose a charging location (a `charging` setting, two dated rows per quarter) or the app
  assumes home charging, and whether that is worth a task before the public beta.

- **2026-09-25, w1 travel-cost: GOV.UK check (closed).** The earlier entry asked the coordinator
  or owner for the advisory-fuel-rates figures because the sandbox could not reach `www.gov.uk`.
  Closed the same day: the owner opened the environment's network, the finishing session read the
  page itself (last updated 21 August 2026) and the AMAP and minimum-wage pages, and seeded every
  band for the 1 Mar, 1 Jun and 1 Sep 2026 quarters exactly as published; the second review had
  supplied the same figures from the page on the same day and they match. Nothing is needed from
  the owner for this.

- **2026-09-24, w1 travel-cost: default rate and value-of-time choice.** `docs/design/drafts/search-map-routes.md` §10 lists two product decisions still open for the owner: row 7, the travel cost per mile default (the HMRC advisory fuel rate at 14p, the HMRC 55p business rate, or no default at all), and row 8, the value-of-time default (£12.71/hour, the National Living Wage, or £0 — "counting time means fewer hints" shown to a user). Both rows already carry a recommended default in the draft. Option taken: this module ships those recommended defaults as the conservative choice — a new user's settings resolve to the `fuel-only` preset (the advisory fuel rate, a dated row, reviewed each quarter) with time counted at the National Living Wage rate unless the user sets £0 ("don't count my time", the card's own escape hatch) — and every figure stays fully user-overridable per the card ("each user's preset ... value of time (including £0)"), so the owner's eventual answer changes only the shipped default, never the mechanism. Needed from the owner: confirm the advisory-fuel-rate default (over the business rate or no default) and the £12.71 value-of-time default (over £0), since row 8 explicitly trades off against how many "slightly further away" hints `deal-hints` will show once it ships.
