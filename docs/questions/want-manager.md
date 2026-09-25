# Open questions — want-manager module

Same format as `docs/questions.md` (date, task, question, option taken and why), kept in its own
file per module so parallel build sessions never conflict. The coordinator folds these into
`docs/questions.md` at a check-in.

- **2026-09-25, want-manager (w2): `FeedFilter` is `listing-search`'s, not built.** The card
  stores `filter: FeedFilter`, "the saved search-map-routes filter that 'Save as hunt' writes",
  and `listing-search` owns that contract; the edge is soft (`docs/design/modules/soft-edges.json`).
  Option taken: `WantManagerFeedFilter` in this module's contracts file is a bounded placeholder
  (query, sort, price band, handover, condition; every field optional, every size capped), stored
  as JSONB in `wants.filter`. When `listing-search` lands, its `FeedFilter` replaces the placeholder
  without a column change. Conservative because nothing computes from the filter yet, and an
  unbounded JSON column would fail the "every input is bounded" self-check.
- **2026-09-25, want-manager (w2): the search preview is a stub.** The card wants the want
  screen to say how many current deals a want would match; that is `listing-search`'s query. Option
  taken: `previewWant()` takes an injected `searchPreview` port whose documented stub
  (`noSearchPreview`) answers `null`, and `WantManagerPreview.matchingDeals` is nullable so the
  screen shows no count rather than an invented one. The estimate procedure the cadence slider
  expects (`WantManagerCadenceEstimate`, credits per month, run-out date) is not built either: its
  numbers come from spend-governor's credit prices, which are the owner's, so the web app keeps
  passing `null` as it does today. Conservative because it shows nothing rather than a guess
  (CLAUDE.md, "No invented numbers").
- **2026-09-25, want-manager (w2): the Free want limit is 3 in the card but 1 in
  `subscriptions`' fallback.** The card and `docs/decisions.md` ("Free-tier limits: 3 active
  hunts") say 3 while `subscriptions` is off; `subscriptions`' own Free fallback
  (`SUBSCRIPTIONS_FREE_FALLBACK.wants`, used while pricing-console has no `free` row) is 1. Option
  taken: with `subscriptions` off, the card's 3 (`WANT_MANAGER_FREE_ACTIVE_WANT_LIMIT`); with it on
  or in shadow, whatever `getEntitlement()` returns, so today a free user gets 1 until the
  pricing-console ladder carries a `free` row. Conservative because the live number always comes
  from the module that owns entitlements, never retyped here, and the smaller limit applies while
  billing runs.
- **2026-09-25, want-manager (w2): per-want alternative controls live on `wants`.** The card
  flags the conflict: the alternative controls are drafted per hunt, but `preferences` is keyed by
  user. Option taken: `wants` carries `alternatives`, `pc_containment`,
  `alternatives_max_price_minor`, `instant_alternatives` and `instant_top_picks` with the card's
  defaults; `preferences` keeps only the per-user hide flags, channels and quiet hours. Conservative
  because it is the shape the card's own text describes and adds no second per-want table.
- **2026-09-25, want-manager (w2): defaults shown to users.** Product choices this module had to
  pick a value for, all recorded as starting values: the want form's starting cadence is 15 minutes
  (`WANT_MANAGER_DEFAULT_CADENCE_SECONDS`, the middle of the ladder and cheaper than the card's
  5-minute example; the module never sets it, the form does); a user with no preferences row hides
  noise and likely spam and shows multi-quantity listings, with no channels chosen; the radius input
  is bounded at 1 000 km (the user "sets it freely", but every input is bounded) and shown in miles
  by the web app; the error messages in `services/want-manager/src/index.ts` are placeholders for
  the owner's wording. Conservative because each hides or costs less.
- **2026-09-25, want-manager (w2): who reads a want's owner.** No internal view carries a user ID
  (card, "Views"), yet `alert-router` and `notifier` must deliver a match to its owner. Option
  taken: an exported pipeline function `wantOwners(q, wantIds)` (at most 500 IDs, inside
  `withPipeline`) rather than a view. Conservative because the read is explicit, batched and
  auditable in code, and the views stay free of user IDs.
- **2026-09-25, want-manager (w2): the user-facing view lives in `want_manager`, not `app`.**
  No `app` schema exists on `main` yet (the gap `services/listing-feedback/README.md` records).
  Option taken: `want_manager.v_want_manager_wants`, moved to `app.v_want_manager_wants` once the
  web app's oRPC layer creates `app`.
