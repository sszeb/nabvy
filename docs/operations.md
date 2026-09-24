# Operations

## Environments

| Environment | Data | Runtime | Purpose |
| --- | --- | --- | --- |
| development | Supabase branch per developer or a shared dev project; eBay Sandbox; Apify with `maxItems` caps | Trigger.dev dev runner; Next.js local | Building tasks |
| staging | Supabase branch off production schema with seeded fixtures | Trigger.dev staging env; Vercel preview | Every pull request; provider calls capped at £1/day |
| production | Supabase project `fbapfy` (eu-west-1) | Trigger.dev prod; Vercel production; nabvy.app and nabvy.com | Real users |

Time zone for schedules and reports: Europe/London. Currency GBP only.

## CI/CD (GitHub Actions)

On every pull request: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:fixtures` (pass rate must not drop), `gitleaks`, `pnpm audit --audit-level=high`, migration dry-run against a Supabase branch, Vercel preview deploy. On merge to `main`: Drizzle migrations applied to production, Trigger.dev deploy, Vercel production deploy, then a smoke test (one watch run on a test unit, one synthetic alert to a test Telegram chat). Rollback: revert the merge; migrations are forward-only, so destructive changes ship in two steps (add, migrate data, remove later).

## Monitoring and alerts

- **Sentry:** errors in web and tasks; alert on new issue types and on error rate above 2% of task runs.
- **Ops monitor rollups (`metrics_daily`):** freshness per source and tier, provider spend, model spend per listing, alert precision, active users, scans per day.
- **Alerts to the founder (Telegram):** provider paused; provider or model spend over 80% of daily cap; freshness p50 above the source floor + 5 minutes for an hour; Stripe webhook failures; zero new listings from an active source for 2 hours; task dead-letter queue above 20 items.
- **Public freshness page** on nabvy.com shows yesterday's median freshness per source, the honest speed claim.

## Runbooks

- **Provider paused (cap or health):** check `provider_calls` error messages; if the actor is blocked, switch the unit's primary to the fallback and open an issue on the actor; if the cap was hit, review cadence versus revenue for the cell.
- **Facebook outage longer than 2 hours:** set the source to "delayed" in the app banner; keep eBay and Gumtree running; do not raise cadence to compensate.
- **Extraction pass rate drops:** run `pnpm test:fixtures`; if a model change caused it, pin the previous model version; if listing formats changed, add fixtures and adjust the pack regexes, not the pipeline.
- **Stripe webhook failures:** replay from the Stripe dashboard; entitlements are idempotent by event ID.
- **eBay rate limit reached:** requests queue for the next day; request an Application Growth Check.
- **Data incident:** revoke affected keys, note in `incidents`, assess whether personal data was involved and whether the ICO must be notified within 72 hours.

## Testing strategy

- Unit and fixture tests per module (Vitest).
- Contract tests for adapters against recorded raw responses; a live smoke test per adapter behind a flag.
- End-to-end (Playwright): sign-up, hunt, alert feed, feedback, scan with a fixture image, checkout in Stripe test mode.
- Load check before public launch: 100 active cells at 5-minute cadence for one hour on staging with provider stubs; pipeline delay `T6 − T1` must stay under 30 s at p95.
- Weekly parser-drift run: fixtures plus 20 fresh listings per source, reviewed in the Review Console.

## Support

- Support address hello@nabvy.com; in-app feedback on every deal card and scan card; a status line on the public freshness page. Target first response within one working day during beta.

## Launch checklist

- Production keys for all providers; caps set; kill switches tested.
- Stripe live mode: products, prices, tax settings, legal entity, webhook endpoint verified.
- Legal documents published; cookie banner live; affiliate disclosure visible; ICO registration done.
- RLS tests green; secrets scan clean; external security scan done.
- Backups and point-in-time recovery enabled; weekly data export scheduled.
- Public freshness page live with real numbers; support address monitored.
- Facebook legal gate: only if cleared, otherwise Facebook alerts remain private.
