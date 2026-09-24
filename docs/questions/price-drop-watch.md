# Questions: price-drop-watch

Same format as `docs/questions.md`; the coordinator folds these entries into it.

- **2026-09-24, w1 price-drop-watch: the relist-merge announcement dedupe mechanics (catalogue
  question 21).** The card lists `relist-merge.merged` as an input and says "relist-merge only
  stops the same item alerting twice", but does not say how, and a watch never moves to another
  listing ID. Option taken: every price drop is still written to its own watch's `drops` row (so
  each watch keeps a complete history), and only a batch's *announcement* dedupes — one
  announcement per `(relistGroupId, toMinor)` per batch, the earliest watch by `watchCreatedAt`
  then `watchId` wins (`services/price-drop-watch/src/domain/index.ts`,
  `dedupeAnnouncements`). `relistGroupId` is an extra column on `drops` beyond the card's own
  list, like relist-merge's own `matched_listing_id`. Conservative because it never merges or
  moves state across listing IDs, never widens what a user sees, and only ever reduces duplicate
  notifications within one check pass; the owner may want a different scope (for example,
  deduping across passes, or by user rather than by group).
- **2026-09-24, w1 price-drop-watch: the idempotency key uses only `cardHash`, not rule 8's
  `cardHash + evidenceHash` for "price stages".** Rule 8 of `docs/design/modules/_rules.md`
  groups "price-drop watch" with index/position/price-facts stages that read both a card and a
  detail-evidence hash. This module's own card lists no `detail-evidence` dependency and describes
  its history as "card sightings the app already collects" (never detail text), so there is no
  `evidenceHash` to include. Option taken: `drops`'s idempotency key is `(watch_id, card_hash)`,
  where `card_hash` is listing-ingest's own sighting hash, copied verbatim, never recomputed here.
  Conservative because it deviates from the rule only where the card itself gives this module no
  detail-evidence input to hash; if a later card revision adds one, the key gains `evidenceHash`
  then.
- **2026-09-24, w1 price-drop-watch: the first `app.*` view needs a `SECURITY DEFINER` read
  helper for another module's internal views.** No module has created the Postgres `app` schema
  yet (`services/account/README.md`, "Decisions"). This module is first, and its user-facing
  history view needs to read `listing_ingest.v_listings`/`v_price_changes`, which are internal
  views granted only to `nabvy_pipeline` (rule 5) — a `security_invoker` view queried by `nabvy_app`
  cannot reach them directly. Option taken: `create schema if not exists app` in this module's own
  access migration (idempotent, so a second module's migration in the same wave is a no-op), and a
  `SECURITY DEFINER` function `price_drop_watch.listing_price_history(uuid)`, owned by the
  migration role and granted execute to `nabvy_app`, wrapping the cross-module read — the same
  pattern `listing_suppression.is_suppressed()` already uses. The outer view stays
  `security_invoker` and touches only this module's own `watches`, so RLS still applies. Conservative
  because it grants nothing new to `nabvy_app` on another module's tables; the coordinator or a
  later module may want to formalise this as the standard way a user-facing view reads another
  module's internal data, since `nabvy_core.view_violations()` does not check the `app` schema at
  all (it only scans schemas the migration ledger lists as modules), so each module doing this
  differently would be easy to miss in review.
