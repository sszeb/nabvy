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

**Spend.** `apify_gateway.spend` shows the cap, the committed amount and what remains. Apify
finalises a run's `usageTotalUsd` a few minutes after the run ends (the first run read $0.0003 at
finish and settled at $0.0177), so a started run counts at the larger of its provisional cost and
its reservation until an invocation at least 10 minutes after it finished re-reads the final cost
and sets `settled_at`. The cap is $5.50, the owner's £5 budget for
paid runs. A run's reservation uses upper bounds held in `settings`: $0.40 per compute unit,
$10/GB of proxy traffic and 0.5 MB per request. A run that costs more than its reservation is
still counted in full once it settles.

**Guardrails.** `settings.actor_id` can only be `YfdUav3sZ2BgEf8rh`. The schema, tables and
functions are revoked from `public`, `anon` and `authenticated`, RLS is on with no policies, and
the schema is not exposed to the Data API.

**Seller data.** `apify_gateway.items` holds raw actor rows, which can include seller fields. Per
the brief they are internal only: never copy them into user-facing tables, fixtures or logs.

**Redacted copies for fixtures.** `apify_gateway.redacted_items(job_id)` returns a job's rows with
every `seller` and `marketplace_listing_seller` object replaced by a same-shaped placeholder (an
unknown seller key raises an error rather than passing through), Facebook media and profile URLs
replaced by placeholders, and emails and UK phone numbers in text masked.
`apify_gateway.redaction_leaks(job_id)` lists any raw seller ID, name or picture URL still present
in the redacted rows and must return nothing before rows are exported. Only redacted rows ever
leave the database.

**Secret.** The function reads the Edge Function secret `APIFY_TOKEN` (Edge Functions → Secrets
in the `fbapfy` dashboard) and fails with a clear error if it is missing. Update it there when the
token is rotated. The function never logs or returns the token. An `env_check` job reports which
Apify-like and project-added secret names exist (names only), so a token saved under an unexpected
name can be found. Until the owner added `APIFY_TOKEN`, the token was held briefly in Supabase Vault;
that copy was deleted on 2026-09-24 once the secret was confirmed working.

**Operating it.**

```sql
insert into apify_gateway.jobs (kind) values ('actor_info');           -- free
select apify_gateway.enqueue_run('{...}'::jsonb, 1024, 300, 'why');     -- paid, capped
select apify_gateway.invoke();                                          -- start or collect
select * from apify_gateway.spend;
select id, kind, status, cost_usd, error from apify_gateway.jobs order by id;
```

Migrations in `migrations/` were applied through the Supabase connector on 2026-09-24:
`20260924020000_apify_gateway.sql` (schema), `20260924021000_apify_gateway_search_path.sql`
(security advisor fix), `20260924022000_apify_gateway_settle_cost.sql` (cost settlement) and
`20260924023000_apify_gateway_redact.sql` (redacted copies for fixtures, below).
Deployed function version: 7. Versions 4 and 6 were not deployed from this repository (most likely
the dashboard redeploying when secrets changed); each later deploy replaced them.
