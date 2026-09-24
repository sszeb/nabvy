# supabase

Supabase-side code for project `fbapfy` (`rlgufxmsrkhyeiabdeic`, eu-west-1).

## Apify gateway (bootstrap, 2026-09-24)

The owner's rule is that the Apify token lives only as a Supabase Edge Function secret
(`docs/fb-actor-sources.md`), so the one piece of code that talks to Apify is the Edge Function
`functions/apify-gateway`. It is a bootstrap for connecting to the actor and recording its real
fields (task 1.0). When the actor brief's `APP_INTEGRATION_GUIDE.md` lands, this gateway is
reviewed against it and folded into the provider adapter (task 1.1), and the schema below moves
into `packages/db` with task 0.3.

**How it works.**

1. Work is queued as rows in `apify_gateway.jobs` by SQL, which only the database owner can run.
   `apify_gateway.enqueue_run(input, memoryMb, timeoutSecs, note)` validates a run's input
   (input version 3, `maxRequests` and `maxRunSeconds` required, `browserFallback` false, no
   `startUrls`, explicit proxy) and reserves its worst-case cost.
2. `select apify_gateway.invoke()` asks the function (via `pg_net`) to work through the queue.
   The function takes no instructions from the request, so invoking it grants nothing; it is
   deployed with `verify_jwt` off for that reason.
3. `apify_gateway.claim_next_job()` hands out jobs one at a time under a lock and refuses any run
   whose reservation would take committed spend past `settings.cap_usd`.
4. The function starts runs asynchronously and, on later invocations, collects finished runs: the
   dataset rows go to `apify_gateway.items`, the run's cost (`usageTotalUsd`) and `RUN_SUMMARY`
   to the job's `result`.

**Spend.** `apify_gateway.spend` shows the cap, the committed amount (settled costs plus the
reservations of runs still going) and what remains. The cap is $5.50, the owner's £5 budget for
paid runs. A run's reservation uses upper bounds held in `settings`: $0.40 per compute unit,
$10/GB of proxy traffic and 0.5 MB per request. A run that costs more than its reservation is
still counted in full once it settles.

**Guardrails.** `settings.actor_id` can only be `YfdUav3sZ2BgEf8rh`. The schema, tables and
functions are revoked from `public`, `anon` and `authenticated`, RLS is on with no policies, and
the schema is not exposed to the Data API.

**Seller data.** `apify_gateway.items` holds raw actor rows, which can include seller fields. Per
the brief they are internal only: never copy them into user-facing tables, fixtures or logs.

**Secret.** The function reads `APIFY_TOKEN` from the Edge Function secrets and never logs or
returns it. An `env_check` job reports which Apify-like secret names exist (names only).

**Operating it.**

```sql
insert into apify_gateway.jobs (kind) values ('actor_info');           -- free
select apify_gateway.enqueue_run('{...}'::jsonb, 1024, 300, 'why');     -- paid, capped
select apify_gateway.invoke();                                          -- start or collect
select * from apify_gateway.spend;
select id, kind, status, cost_usd, error from apify_gateway.jobs order by id;
```

The migration is `migrations/20260924020000_apify_gateway.sql`, applied through the Supabase
connector on 2026-09-24.
