# @nabvy/apify-gateway

The only module that talks to Apify: it checks a run, reserves its cost, starts it, collects
every row and settles its cost, and tells the pipeline when a run is collected and settled
(`docs/design/modules/apify-gateway.md`).

A module session edits only this folder, `packages/contracts/src/modules/apify-gateway.ts`,
`packages/config/src/modules/apify-gateway.ts`, `packages/db/src/schema/apify-gateway.ts`,
`packages/db/migrations/apify-gateway/`, `packages/db/tests/apify-gateway.test.sql` and
`fixtures/contracts/apify-gateway/`, plus the gateway it took over: `supabase/functions/apify-gateway/`,
`supabase/tests/apify-gateway.test.sql` and `supabase/README.md`.

## Switch and priority

Off by default (rule 11). The gateway works only while its module switch `apify-gateway` is on or
in shadow, the provider switch `apify` is on and the global `pipeline` switch is on. It **fails
closed**: switches are read through `@nabvy/switches` (TypeScript) and `switches.state()` (SQL),
and an unknown or unreadable switch reads `off`. While it is off, `submitRun` queues nothing, the
database hands the Edge Function no job, the Edge Function does nothing at all, the watcher writes
and publishes nothing, and the `v_` views return no rows. Users lose new Facebook listings; every
other module carries on with what it has. While `cost-meter` is off, no paid run is queued.

Shadow behaves like on: the gateway has no user-facing output. P1 (the card).

## Inputs

- `submitRun(q, ApifyGatewaySubmitRunInput)` from `check-scheduler` and `details-queue`: the run
  shape, the actor input, memory, timeout and tags (requesting module, region, purpose).
- `watch(q, { publisher, usdGbpRate })`, one tick of the `apify-gateway-watch` task, every minute.
- Switches `apify-gateway`, `apify`, `pipeline` and `cost-meter`, through `@nabvy/switches`.
- No events consumed.

## Outputs

- **Events** (keyed by job ID, so each job is announced once):
  - `apify-gateway.run-collected` v1 `{ jobId, apifyRunId, kind: search | details }`, key
    `apify-gateway.run-collected:<jobId>`, once a job's rows are all stored.
  - `apify-gateway.run-settled` v1 `{ jobId }`, key `apify-gateway.run-settled:<jobId>`, once a paid
    run's final cost is in cost-meter.
- **Internal views** (`nabvy_pipeline`; empty while the module is off; security_invoker):
  - `apify_gateway.v_jobs`: id, kind, run_kind, status, tags, input, memory_mb, timeout_secs,
    reserve_usd, cost_usd, apify_run_id, item_count, error, started_at, finished_at, settled_at,
    announced_at, created_at, updated_at (row type `ApifyGatewayJob`).
  - `apify_gateway.v_run_summaries`: job_id, apify_run_id, run_kind, summary (the whole
    `RUN_SUMMARY`), detail_route, searches.
  - `apify_gateway.v_rows`: job_id, seq, record_type, listing_id, item (the row with every `seller`
    and `marketplace_listing_seller` key removed, at any depth).
  - `apify_gateway.v_seller_presence`: job_id, seq, present (whether the row has a seller object;
    nothing about the seller).
- **Restricted view** `apify_gateway.restricted_rows` (job_id, seq, item: whole rows, seller fields
  included), for the seller-data allowlist of rule 6 only. It ignores the switch, so erasure can
  always reach the rows.
- **User-facing views:** none.
- **Functions** (`@nabvy/apify-gateway`): `submitRun`, `watch`, `readJobs(q, jobIds)`,
  `readSwitches`, and the pure helpers `gatewayOpen`, `runKindOfInput`, `usdToMicros`.

## Tables

Schema `apify_gateway`, created by `supabase/migrations` (the bootstrap) and extended by
`packages/db/migrations/apify-gateway`:

- `jobs`: `id` (identity), `kind` (`env_check | actor_info | run | collect`), `status`
  (`pending | running | succeeded | failed | refused`), `input`, `run_options`, `reserve_usd`,
  `apify_run_id`, `cost_usd`, `settled_at`, `result` (the Apify run object with `itemCount` and
  `runSummary`), `error`, `note`; new: `tags`, `metered_at`, `announced_at`, `settle_announced_at`.
  The three watcher times are set once and never change (trigger).
- `items`: `(job_id, seq)` primary key, `item` (the row, whole).
- `settings` (one row): `actor_id` (only `YfdUav3sZ2BgEf8rh`), `cap_usd`, reservation bounds,
  `download_page_size`, `function_url`; new: `actor_build`.
- View `spend` (owner only): the cap, this month's committed spend, what remains, the month.

## How the Edge Function and this package divide the work

| | Edge Function `supabase/functions/apify-gateway` | Package `@nabvy/apify-gateway` |
| --- | --- | --- |
| Holds the Apify token | Yes, the only code that does (`APIFY_TOKEN`) | Never |
| Talks to Apify | Starts runs (pinned build), polls, downloads datasets and `RUN_SUMMARY`, re-reads settled costs | Never; a conventions test fails any file outside the function naming Apify's API host |
| Writes jobs | Claims, starts, stores rows and results, settles `cost_usd` | Queues runs through `enqueue_run(…, tags)`; sets only the watcher times |
| Money | The monthly cap at claim time (`claim_next_job`) | Refuses to queue while cost-meter is off; records reservations and settlements in cost-meter |
| Switches | `apify_gateway.enabled()` at the top of every invocation and in `claim_next_job` | `@nabvy/switches` in `submitRun` and `watch` |
| Tells the pipeline | Nothing | `run-collected`, `run-settled`, and the views |

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Spend cap | $150 per calendar month, Europe/London, by the job's `created_at` | Owner, `docs/decisions.md` ("Budget", 2026-09-24); actor-integration.md 3.5 | Owner's value |
| Reservation bounds | $0.40/CU, $10/GB, 0.5 MB per request, + $0.01 | `supabase/README.md`, "Spend" | Unchanged |
| Build pin | 1.0.82 | The recorded run's build; `docs/decisions.md` ("pin the actor build") | Starting value |
| Settlement read | ≥ 10 minutes after the run finished | `supabase/README.md`, "Spend"; cost-meter's `APIFY_SETTLE_DELAY_MS` | Matched to cost-meter |
| Input rules | As `enqueue_run` (input version 3, `maxRequests` 1–1,000, timeout ≥ `maxRunSeconds` + 60 s, GB residential proxy, no `startUrls`, `browserFallback` and `useDetailCache` false, integers as JSON integers, searches or IDs) | `supabase/README.md`, "Input rules" | Unchanged |
| Shape and kind | A search shape needs `searchTerms` and no `listingIds`; a details shape the reverse | actor-integration.md 2.3 | Fixed |
| Tags | `module` (kebab case), `region`, `purpose`, `shape`: strings of 1–100 characters, no other key | The card | Fixed |
| Watch batch | 100 jobs per step and tick | `CLAUDE.md`, "Batches, not items" (`APIFY_GATEWAY_WATCH_BATCH_SIZE`) | Starting value |

## Fixtures and pass rate

Stage `watch` (`test/fixtures/watch.fixtures.ts`), run on the real migrations in PGlite, with the
Edge Function's SQL steps played from the recorded run `VkryjpwS6U2GBDh3k`
(`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`):

- `recorded-run-collect`: the recorded run replayed through a free `collect` job gives one
  `run-collected` (kind `search`); `v_rows` has 21 rows, 20 listings, no seller key; 3 rows have a
  seller; nothing is metered; a second tick does nothing.
- `recorded-run-paid`: the same run submitted as a paid run: reservation $0.3363 recorded in
  cost-meter, one `run-collected`, then $0.0177 settled and one `run-settled`.
- `start-failed` (synthetic, from the Edge Function's failure path): nothing metered or announced.

Pass rate 3/3 (2026-09-24). Other tests: `domain.test.ts`, `idempotency.test.ts` (a second tick
writes nothing; a tick that fails after publishing re-publishes the same keys, which the transport
drops), `switch.test.ts`, `contracts.test.ts`, `conventions.test.ts`, and
`packages/db/tests/apify-gateway.test.sql` (switches, tags, the monthly boundary, the build pin,
views, the watcher times and every privilege). `supabase/tests/apify-gateway.test.sql` keeps the
bootstrap's checks. No other module reads the gateway yet, so "a reader's fixtures pass with this
module off" waits for `listing-ingest` (task 1.3a).

## Decisions

- **2026-09-24: the schema keeps its name and joins the ledger.** `apify_gateway` stays reserved
  for every other module; `schemaNameOf('apify-gateway')` maps to it (`packages/db/src/module-schema.ts`).
  `supabase/migrations` stay the record of what was applied before the module; this module's
  changes are hand-written in `packages/db/migrations/apify-gateway/`, which the runner applies
  after them. The Drizzle file mirrors the live tables for typed queries and is never used to
  generate a migration.
- **2026-09-24: security_invoker views and table grants.** Joining the ledger puts the schema under
  the foundation's view check, so every view there, `spend` included, is security_invoker, and
  `nabvy_pipeline` needs `SELECT` on `jobs` and `items` beneath the views (with RLS pipeline
  policies), against the plan's "no grant on `items`". Which packages may name the tables,
  `enqueue_run` or `restricted_rows` is enforced by `test/conventions.test.ts` until per-module roles
  exist (`docs/questions.md`, "w1 apify-gateway: pipeline grants on the gateway tables").
- **2026-09-24: fail closed everywhere.** `apify_gateway.enabled()` gates `claim_next_job()` (so
  even an older deployed function starts nothing), the Edge Function, and the pipeline's
  `enqueue_run`; the owner's four-argument `enqueue_run` still queues, but nothing is claimed while
  off (`docs/questions.md`, "the gateway is inert until switched on").
- **2026-09-24: shadow runs.** Rule 11: shadow runs and writes; the gateway has no user-facing
  rows, so shadow and on behave the same.
- **2026-09-24: the monthly cap by `created_at`.** A run counts in the London calendar month its job
  was created in, at its reservation (or provisional cost, if larger) until settled, and at its
  settled cost afterwards, in that same month (actor-integration.md 3.5). The first cap raise, from
  the $5.50 lifetime test budget to $150 a month, is in this migration; the bootstrap's SQL tests
  set $5.50 inside their own transaction.
- **2026-09-24: metering follows the start.** `submitRun` cannot record the reservation in cost-meter
  because cost-meter keys an Apify call by its run ID, which exists only once the Edge Function
  starts the run. The gateway's cap counts the reservation from the moment the job is queued; the
  watcher records it in cost-meter on the next tick after the start (`metered_at`), and settles it
  after the gateway's settlement pass (`settle_announced_at`). A collect job costs nothing and is
  never metered.
- **2026-09-24: publish, then mark.** The watcher publishes a batch's events before it sets their
  times; the keys are the job IDs, so a crash in between re-publishes the same keys and the
  transport drops them. Jobs whose run kind is unknown (a collect job with no `RUN_SUMMARY`) are
  not announced and stay visible in `v_jobs`.
- **2026-09-24: run kind of a collect job.** Its input names only the Apify run, so the kind comes
  from `RUN_SUMMARY.searches` (one or more: `search`; none: `details`). Inference from the recorded
  run; to confirm on the first recorded details run (task 1.0a).
- **2026-09-24: invoking.** `submitRun` invokes the gateway at once (A2); each watcher tick invokes
  it while jobs are pending, running or unsettled, which stands in for pg_cron (A1)
  (`docs/questions.md`, "invoking without pg_cron").
- **2026-09-24: resumable download.** The Edge Function stores each dataset page in one statement,
  so stored rows are always `0..n-1`; a download an earlier invocation left short now resumes after
  the last stored row instead of restarting from offset 0 under the 120 s `pg_net` timeout.
- **2026-09-24: the watcher task is not in `trigger/` yet.** No Trigger.dev account exists
  (`trigger/README.md`); the task is a thin wrapper that calls `watch(tx, { publisher, usdGbpRate:
  loadEnv(['exchangeRate']).USD_GBP_RATE })` inside `withPipeline`, added with the first tasks.

## Open questions

`docs/questions.md`: "w1 apify-gateway: the gateway is inert until switched on", "pipeline grants
on the gateway tables", "invoking without pg_cron", "not built in 1.1c"; card questions 6, 7 and 9.

## Incidents

None.
