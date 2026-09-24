# supabase

Supabase-side code for project `fbapfy` (`rlgufxmsrkhyeiabdeic`, eu-west-1).

## Apify gateway (bootstrap, 2026-09-24)

The owner's rule is that the Apify token lives only as a Supabase Edge Function secret
(`docs/fb-actor-sources.md`), so the one piece of code that talks to Apify is the Edge Function
`functions/apify-gateway`. It is a bootstrap for connecting to the actor and recording its real
fields (task 1.0). Once Nabvy's own integration plan is agreed (`docs/decisions.md`, "The actor is a
tool"), this gateway is reviewed against
it and folded into the provider adapter (task 1.1), and the schema below moves
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
   dataset rows go to `apify_gateway.items`; the whole Apify run object, with `itemCount` and the
   `RUN_SUMMARY` record added, goes to the job's `result`; the run's cost (`usageTotalUsd`) goes
   to `cost_usd`.

**Lossless collection** (owner's decision: keep everything the actor returns). The function
downloads every page of the dataset (`settings.download_page_size` rows per request, 1,000 by
default) without Apify's `clean` filter, so empty rows and hidden fields are kept. Response text is
handed to Postgres as-is and never parsed by JavaScript first, so numbers keep their exact digits.
A job is not finished until the rows stored match the dataset's `itemCount`. A short download, or a
`RUN_SUMMARY` read that fails for any reason except "not found", leaves a `run` job running for the
next invocation to try again, and marks a `collect` job failed (queue another). Rows are keyed by
`(job_id, seq)`, so a repeated download adds nothing twice.

A free `collect` job re-downloads any finished run of the configured actor by its Apify run ID. It
starts nothing, so it costs no actor spend and the cap does not apply. On 2026-09-24, collect job 15
re-downloaded run `VkryjpwS6U2GBDh3k` in pages of 5; all 21 rows matched the rows stored by job 6
exactly.

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

**Seller data.** `apify_gateway.items` holds the actor's rows complete and unredacted, seller fields
included (owner's decision, `docs/decisions.md` "Actor data kept in full"). Developers see all of it;
only end users of the app are never shown seller identity.

**Redacted copies for fixtures.** `apify_gateway.redacted_items(job_id)` returns a job's rows with
every `seller` and `marketplace_listing_seller` object replaced by a same-shaped placeholder (the ID
becomes a placeholder of the same kind; every other value, whatever its key, becomes `[redacted]` or
a placeholder URL), Facebook media and profile URLs replaced by placeholders, and emails, UK phone
numbers, social handles and links, and the inward half of full postcodes masked in text.
`apify_gateway.redaction_leaks(job_id)` lists (by row and length only) any string from a raw seller
object still present in the redacted rows, and must return nothing before rows are exported. Only redacted rows ever
leave the database.

**Secret.** The function reads the Edge Function secret `APIFY_TOKEN` (Edge Functions → Secrets
in the `fbapfy` dashboard) and fails with a clear error if it is missing. Update it there when the
token is rotated. The function never logs or returns the token. An `env_check` job reports which
Apify-like and project-added secret names exist (names only), so a token saved under an unexpected
name can be found. Until the owner added `APIFY_TOKEN`, the token was held briefly in Supabase Vault;
that copy was deleted on 2026-09-24 once the secret was confirmed working.

**Tests.** `pnpm db:dry-run` applies every migration to a local throwaway Postgres (with stand-ins
for Supabase's roles and `pg_net` from `tests/supabase-stubs.sql`) and runs `tests/*.test.sql`:
input validation, reservations, the spend cap, cost settlement, `collect` jobs, redaction and
privileges. CI runs it
on every pull request. The script refuses any non-local database.

**Operating it.**

```sql
insert into apify_gateway.jobs (kind) values ('actor_info');           -- free
insert into apify_gateway.jobs (kind, input)
  values ('collect', '{"apifyRunId": "<run id>"}');                     -- free, re-download a run
select apify_gateway.enqueue_run('{...}'::jsonb, 1024, 300, 'why');     -- paid, capped
select apify_gateway.invoke();                                          -- start or collect
select * from apify_gateway.spend;
select id, kind, status, cost_usd, error from apify_gateway.jobs order by id;
```

Migrations in `migrations/` were applied through the Supabase connector on 2026-09-24:
`20260924020000_apify_gateway.sql` (schema), `20260924021000_apify_gateway_search_path.sql`
(security advisor fix), `20260924022000_apify_gateway_settle_cost.sql` (cost settlement) and
`20260924023000_apify_gateway_redact.sql` and `20260924024000_apify_gateway_redact_v2.sql` (redacted
copies for fixtures, above) and `20260924025000_apify_gateway_collect.sql` (the `collect` job and
the download page size).
Deployed function version: 9 (2026-09-24), matching `main`; it restores the `status = 'running'`
guard on the final job update that version 8 dropped.

**Migration versions differ on Supabase.** Applying through the connector recorded each migration
under the time it was applied: `20260924013224`, `013419`, `014328`, `020511`, `070930` and `075225`.
The names and content match the repository files `20260924020000` to `025000`. The Supabase CLI
would see the repository files as unapplied; reconcile with `supabase migration repair` before
anyone uses the CLI against `fbapfy`. Versions 4 and 6 were not deployed from this repository (most likely
the dashboard redeploying when secrets changed); each later deploy replaced them.
Until this is reconciled, point neither the Supabase CLI nor Supabase's GitHub or branching
integration at `fbapfy`; apply migrations only through `migrate.mjs emit` or the connector.
