# @nabvy/route-health

Chooses each Facebook acquisition region's detail route, `graphql` or `page`, from recent detail
runs (`docs/design/modules/route-health.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). While off: the handler acknowledges
`apify-gateway.run-collected` and writes nothing; `v_decisions` returns no rows;
`recommendRoute` falls back to the actor's own default, graphql, `insufficient-data`
(card, "When off": "details-queue uses graphql, the actor's default"). Shadow behaves like on:
route-health has no user-facing view. P1 (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:197-201`).

## Inputs

- `apify-gateway.run-collected` (module: `apify-gateway`), detail runs (`kind: 'details'`) only —
  search runs and photo captures (always `page`; graphql returns no gallery) are ignored.
- `apify_gateway.v_jobs` (module: `apify-gateway`): the region an apify-gateway job was tagged
  with, in its `tags.region` (set by `details-queue` through `enqueue_run`).
- `apify_gateway.v_run_summaries` (module: `apify-gateway`): the collected job's
  `RUN_SUMMARY.detailRoute`.
- Switch `route-health`, through `@nabvy/switches`.

## Outputs

- **Event** `route-health.route-switched` v1 `{ regionId }`, key
  `route-health.route-switched:<regionId>@<at>`, once per call that actually moves a region's
  route (not every decision: most calls confirm the current route and emit nothing).
- **Internal view** `route_health.v_decisions` (region_id, route, reason, success_rate, attempts,
  new_query_ids, alert, at): one row per region, its latest decision. No rows while the module is
  off. No user-facing view.
- **Functions** (`@nabvy/route-health`): `recommendRoute(q, regionId)` — a region's current
  decision, for a caller (e.g. `details-queue`) that just wants to know which route to use;
  `recordRun(q, input)` — feeds one collected detail run into a region's history and returns its
  new decision, called by the event handler; `onRunCollected` — the wrapped handler
  (`@nabvy/transport`'s `defineHandler`) a Trigger.dev task file calls.

## Owned tables

Postgres schema `route_health`.

- `route_state`: one row per region (`region_id` primary key). `state` is the whole
  `RouteHealthState` the domain function needs to resume between calls, `lastDecision` included,
  so `v_decisions` and `recommendRoute` read exactly what the last call wrote.
- `route_runs`: one row per detail run, keyed by `apify_run_id` (unique), so a retried scheduler
  tick cannot count a run twice (card: "One history entry per run"). `detail_route` holds the
  run's `RUN_SUMMARY.detailRoute` stats. At least 11 rows are kept per region (`windowRuns` + 1,
  the most the domain function ever looks back); the repo prunes older rows after every insert.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Stay on graphql | ≥95% success over ≥50 replays in the last 10 runs | `fb-scrap-engine/app/route-health.js:6-7,47-96` | Actor default |
| Probe again | every 10th run while on page | same | Actor default |
| Recover | 20 good probe replays | same | Actor default |
| History kept per region | 11 (`windowRuns` + 1) | `windowRuns` (10) + the query-ID lookback window | Starting value |
| Listing with no description counts as a failed replay | unchanged from the actor | `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243`; `docs/questions.md`, "route-health and listings without a description" | Pending owner decision; pinned in tests |
| No replays is never low success | Nabvy divergence from the actor | `src/domain/route-health.ts`, "Divergence" (`fb-scrap-engine/app/route-health.js:54`: `null < minSuccess` is `true` in JavaScript) | Fixed |

## Fixtures and pass rate

Stage `route-decision` (`test/fixtures/route-decision.fixtures.ts`), 7 cases: the actor's core
branches (healthy, low-success, circuit-open, bootstrap-failing), the recorded run
`VkryjpwS6U2GBDh3k` (`insufficient-data`, 19 of 19 — card), the pinned "description missing" and
"no replays" cases above. Pass rate 7/7. `test/domain.test.ts` ports the actor's 8
`route-health.test.js` tests plus the 2 Nabvy tests the card names (the recorded run and the
pinned caveat) — the same port and tests already exist as groundwork in
`services/source-adapters` (task 1.1); reproduced here since this module's own tables, views and
event are new (route-health's "Depends on" line does not include source-adapters, rule 1).
`test/idempotency.test.ts` (a replayed run writes nothing new; history is pruned to 11 rows),
`test/switch.test.ts` (rule 11), `test/handlers.test.ts` (the full `apify-gateway.run-collected`
path: region lookup, search runs ignored, a missing region tag refused) and
`test/contracts.test.ts`.

## Decisions

- **2026-09-24: the domain port is reproduced, not imported, from `services/source-adapters`.**
  The card's "Tests and fixtures" line cites the groundwork already built there (task 1.1,
  `nabvy/services/source-adapters/README.md:163-182`), but this module's "Depends on" line names
  only `switches` and `apify-gateway` (`docs/design/modules/_rules.md`, rule 1: a module's
  dependencies list only its declared hard edges). `src/domain/route-health.ts` is the same port,
  behaviour for behaviour; the coordinator may retire the source-adapters copy once every reader
  of it points here instead (recorded as a question, not decided in this module).
- **2026-09-24: `recommendRoute` and `recordRun` read another module's views directly through
  Drizzle** (`@nabvy/db/schema/apify-gateway`'s `vJobs`, `vRunSummaries`), the sanctioned
  cross-module read path (rule 5; folder shape, `src/repo/`: "reads of other modules' v_ views").
  No `@nabvy/apify-gateway` package dependency is needed: its event registry comes through
  `@nabvy/contracts/modules/apify-gateway` and its views through `@nabvy/db`, both already
  dependencies.
- **2026-09-24: `route-health.route-switched` fires only on an actual route change**, not on
  every processed run, so a reader (e.g. `source-health`, for new Facebook operation IDs) that
  wants every decision reads `v_decisions` directly; the card notes readers use `newQueryIds` from
  the view rather than the event's `alert` flag, since the page route's `alert` is always false
  even when new IDs appear (matching the ported actor behaviour).
- **2026-09-24: the handler wraps its work in `withPipeline` itself.** `HandlerSpec.handle`
  (`@nabvy/transport`) takes no database handle, so `onRunCollected`'s `handle` opens its own
  pipeline transaction; the directly-testable logic (`recordRun`, `handleRunCollected`) takes a
  `Queryable` and is tested against a PGlite harness without going through `withPipeline` or the
  transport wrapper, the same split `services/incidents` uses for `record`/`retry`.

## Open questions

- `docs/questions/route-health.md`.

## Incidents

None.
