# @nabvy/check-scheduler

Decides when each search check runs for each region and submits it as one batched run through
apify-gateway, never per user (`docs/design/modules/check-scheduler.md`).

A module session edits only this folder, `packages/contracts/src/modules/check-scheduler.ts`,
`packages/config/src/modules/check-scheduler.ts`, `packages/db/src/schema/check-scheduler.ts`,
`packages/db/tests/check-scheduler.test.sql` and `packages/db/migrations/check-scheduler/`.

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). Off, or the `pipeline` switch not
on: `tick` returns `{ status: 'off' }` and reads, writes and submits nothing; `onSearchDegraded`
acknowledges and writes nothing; `v_check_runs` is empty (card, "When off: no scheduled checks").
Users lose every Facebook search check, so no new listing is found. Shadow decides and records
each run with `status: shadow` and submits nothing (question "shadow"). P1 (card);
critical-path priority [cp 1].

## Inputs

- `search_planner.v_plan` through `listPlan()` and `search_planner.v_one_off_runs` through
  `listOneOffRuns()` (`search-planner`); `setOneOffRunStatus()` records a one-off as submitted,
  completed or failed.
- `run-coverage.search-degraded` v1 `{ jobId, searchIds }` (`run-coverage`), handled by
  `onSearchDegraded`; it reads `run_coverage.v_search_coverage` (`id`, `job_id`, `centre_id`,
  `term`, `status`) for the named searches.
- `spend_governor.v_throttle` through `readThrottle()` (`spend-governor`), read before any
  submit; it fails closed to `hold-new`.
- `source_health.v_ramp_stage` through `recommendRampStage()` (`source-health`); off or unseeded,
  that function answers the lowest stage (50 checks a day).
- `listing_ingest.v_sightings` (`listing_id`, `job_id`) and `listing_ingest.v_listings` (`id`,
  `first_fetched_at`) (`listing-ingest`), joined to `v_check_runs` for yield.
- `apify_gateway.v_jobs` through `readJobs()` (`apify-gateway`), to settle one-offs.
- `switches.state('check-scheduler')`, `switches.isOn('pipeline')` (`switches`).
- The card's `v_search_coverage`, `v_throttle`, `v_ramp_stage` and `v_sightings` exist under
  those names. The card's `v_plan` has no want count per term class; the module reads
  `paid_want_count` and `rank` per pair, which is what it needs.

## Outputs

- **Runs** through `apify-gateway.submitRun()` only: shapes `newest-check`, `sweep-narrow`,
  `sweep-broad` and `verification`. Every run sends `includeDetails: false`, an explicit `sort`
  (`newest` for newest checks and verifications, `default` for sweeps), `cityId` = the centre,
  searches only (no `listingIds`), tags `{ module: 'check-scheduler', region: <centre>,
  purpose: '<reason>:<kind>' }`.
- **Internal view** `check_scheduler.v_check_runs` (`nabvy_pipeline`; `security_invoker`; empty
  while off): `id`, `job_id`, `centre_id`, `kind`, `shape`, `terms`, `reason`, `status`,
  `tick_at`, `rerun_of`, `one_off_id`, `error_code`, `created_at`, `updated_at`. Row type
  `CheckSchedulerRun`.
- **User-facing views:** none. **Events:** none.
- **Functions** (`@nabvy/check-scheduler`): `tick(q, deps?)` (the Trigger.dev task, every 5
  minutes, inside `withPipeline`), `onSearchDegraded(q, payloads)`, `listRuns(q)`, and the pure
  `planTick`, `searchInput`, `cadenceFor`, `shapeFor`, `startsNew`, `tickSlot`, `inActiveHours`,
  `londonDay`, `compareDecisions`, `levelAtLeast`; `defaultLimits`, `defaultPorts`.

## Tables

Schema `check_scheduler`, pipeline data only (no user rows; `allow_pipeline` policies):

- `schedule`: primary key (`centre_id`, `term_class`, `kind`); `cadence_s` (the cadence it was
  last run at, throttle included), `next_due_at`, `last_run_at`. Rows no runnable pair needs are
  deleted at the next tick.
- `check_runs`: `id` (UUID v7), `job_id`, `centre_id`, `kind` (`newest | catch-up | sweep`),
  `shape`, `terms` (1-20), `reason` (`scheduled | rerun | one-off | verification`), `status`
  (`pending | submitted | refused | shadow`), `tick_at`, `rerun_of`, `one_off_id`,
  `error_code`. Unique (`tick_at`, `centre_id`): one run per region per tick slot. Unique
  `rerun_of`: a degraded search reruns once. Partial unique `one_off_id` where not refused.
  Checks tie `job_id` to `submitted`, `tick_at` to not `pending`, `rerun_of` to `rerun`. No
  delete grant.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Tick slot | 300 s; one run per region per slot; a retried tick submits nothing | Card ("a retried tick submits once") | Starting value |
| Newest-first check | page 1, sort `newest`, hourly, 08:00-22:00 London, 512 MB, 120 s | Actor test T2 (`docs/design/actor-app-guide.md` items 7, 16) | Starting value (questions) |
| Catch-up | never scheduled | T2: "Do not schedule it"; no gateway shape (task 1.1i) | Fixed |
| Full sweep | sort `default`, up to 60 pages a term (fewer so a run stays within 5,000 listings), daily per term class, broad first, 1,024 MB, 900 s | Owner's decision with T2; source-adapters preset C; SCALE_PLAN.md:50-53 | Starting value |
| One run per region | all of a region's due terms in one run, at most 20 | Card (31% cheaper per term); the actor's 20-term limit | Fixed |
| Region order | paid first; rerun, verification, one-off, newest, sweep; yield; rank | `docs/decisions.md` ("favouring paying subscribers") | Starting value |
| Throttle | `slow-free` ×2 free-only newest checks; `slow-paid` ×2 every newest check; `slow-sweeps` ×2 sweeps; `hold-new` starts nothing new; levels compound; nothing dropped | spend-governor's order; `actor-integration.md` 2.12 | Starting value (factor) |
| Ramp cap | term checks submitted per London day ≤ `max_checks_per_day` | source-health's card | Fixed rule; source-health's caps |
| Reruns | a degraded search of this module's own run reruns once, in the original shape, one term; a rerun is never rerun | Card | Fixed |
| One-offs | pending, approved or a verification, with a centre and terms; submitted once while live | search-planner README | Fixed |
| Actor input | `inputVersion` 3, `includeDetails: false`, explicit `sort`, `maxRequests` = terms × (pages + 2) ≤ 1,000, timeout = `maxRunSeconds` + 60 s, cache and fallback off, GB residential proxy | supabase/README.md "Input rules"; source-adapters' `requestBudget` | Fixed |
| Yield window | 7 days | None cited | Starting value |

## Fixtures and pass rate

Stage `tick` (`test/fixtures/tick.fixtures.ts`), 8 synthetic cases (this module reads plan rows,
schedule rows and levels, never listing content): `rtx3090-admin-test-chichester`,
`one-run-per-region`, `throttle-80-slows-free`, `throttle-slow-paid-and-sweeps`,
`hold-new-keeps-queued-work`, `ramp-cap-paid-first`, `night-sweeps-broad-first`,
`rerun-takes-the-slot`. Centre IDs are city-pages' seeded centres (Chichester is the recorded
run's `cityId`). Pass rate 8/8 (2026-09-25).

Other tests: `test/schedule.test.ts` (the card's tests on the real migrations in PGlite with the
gateway faked: one run per region per tick; `includeDetails: false` and an explicit `sort` in
every newest, sweep, verification and rerun run; a degraded search reruns once; the throttle
order at 80% via spend-governor's `levelFor`, read before submit; `hold-new`; the ramp cap and
its London-day reset; a retried tick submits once and a crashed tick rolls back; a refused run
retried; one-offs submitted once and settled; yield order), `test/switch.test.ts`,
`test/idempotency.test.ts`, `test/contracts.test.ts`, `test/domain.test.ts`, and
`packages/db/tests/check-scheduler.test.sql` in `pnpm db:dry-run`.

## Decisions

- **2026-09-25: the input is built here, not by source-adapters' presets.** details-queue builds
  its own input the same way; source-adapters is not a dependency on the card and pins build
  1.0.82 in its run options, while the gateway pins the build itself. The rules are the same
  and cited (supabase/README.md "Input rules"), and the gateway's SQL checks every input again.
- **2026-09-25: one tick is one transaction.** The tick takes an advisory lock, claims each
  region's slot in `check_runs` and calls `submitRun` in the same transaction; the gateway's
  `enqueue_run` and its invoke request are in it too, so a tick that fails after submitting
  rolls back its job with its claim, and a retried tick finds the slot claimed.
- **2026-09-25: due is measured from the last run at today's throttle.** A check is due when
  `last_run_at + cadence(level) ≤ tick`, so a rising throttle slows checks at once instead of
  after their stored `next_due_at`; `next_due_at` stays for the record.
- **2026-09-25: a refused run keeps its slot.** The refusal is recorded against the tick's claim,
  so a retry in that slot does not re-ask; the schedule does not advance, so the next slot tries
  again. A rerun is attempted once, refused or not.
- **2026-09-25: the tick reads its inputs through exported functions.** search-planner,
  spend-governor, source-health and apify-gateway are injected as `CheckSchedulerPorts`
  (`defaultPorts` in production), as details-queue does, so no test submits a live run.

## Open questions

`docs/questions/check-scheduler.md`: the newest cadence and the card's acceptance; active hours;
the throttle factor; catch-up; what the ramp counts; shadow; one run per region; sweeps of many
terms; yield; details one-offs; refused one-offs.

## Incidents

None.
