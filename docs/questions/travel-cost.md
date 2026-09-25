# Open questions — travel-cost module

Same format as `docs/questions.md` (date, task, question, option taken and why), kept in its own
file per module so parallel build sessions never conflict appending to the shared one
(`docs/session-conventions.md`). The coordinator folds these into `docs/questions.md` at a
check-in.

- **2026-09-25, w1 travel-cost: GOV.UK unreachable from the sandbox.** The first review of
  PR #50 blocks on task 4.1h's definition of done ("rate rows with source URLs, checked against
  gov.uk before merge") and asks for a dated `travel_rates` row for every quarter GOV.UK's
  advisory-fuel-rates page has published since 1 Mar 2026. The fix session could not read the
  page: `www.gov.uk` and the National Archives mirror are both refused by the sandbox's egress
  proxy (`EGRESS_BLOCKED`), and a web search returns no figures. Option taken: no rate was
  guessed ("No invented numbers"); the seed still carries only the 1 Mar 2026 petrol
  1,401–2,000cc row, the attempt is logged in `services/travel-cost/README.md` ("GOV.UK check
  log"), and the engine-band enum and CHECK are in place so the missing rows drop straight in.
  Needed from the coordinator or owner: read `https://www.gov.uk/guidance/advisory-fuel-rates`
  from a machine that can reach it, and either paste the page's "last updated" date and its
  tables (every fuel and engine band, for each quarter after 1 Mar 2026) into this session or a
  successor so it can seed them exactly as published, or allow `www.gov.uk` in the environment's
  network policy so the session can read the page itself.

- **2026-09-24, w1 travel-cost: default rate and value-of-time choice.** `docs/design/drafts/search-map-routes.md` §10 lists two product decisions still open for the owner: row 7, the travel cost per mile default (the HMRC advisory fuel rate at 14p, the HMRC 55p business rate, or no default at all), and row 8, the value-of-time default (£12.71/hour, the National Living Wage, or £0 — "counting time means fewer hints" shown to a user). Both rows already carry a recommended default in the draft. Option taken: this module ships those recommended defaults as the conservative choice — a new user's settings resolve to the `fuel-only` preset (the advisory fuel rate, a dated row, reviewed each quarter) with time counted at the National Living Wage rate unless the user sets £0 ("don't count my time", the card's own escape hatch) — and every figure stays fully user-overridable per the card ("each user's preset ... value of time (including £0)"), so the owner's eventual answer changes only the shipped default, never the mechanism. Needed from the owner: confirm the advisory-fuel-rate default (over the business rate or no default) and the £12.71 value-of-time default (over £0), since row 8 explicitly trades off against how many "slightly further away" hints `deal-hints` will show once it ships.
