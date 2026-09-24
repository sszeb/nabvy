# @nabvy/config

Zod-validated environment for every service. Nothing else in the repository reads `process.env`;
Biome's `noProcessEnv` rule enforces this everywhere except `packages/config/src`.

```ts
import { loadEnv } from '@nabvy/config'

const env = loadEnv(['database', 'apify', 'spendCaps'])
env.APIFY_FB_ACTOR_ID // string
env.FB_DAILY_CAP_MINOR // number, default 1000
```

## Module thresholds

Rule 14 of `docs/design/modules/_rules.md`: every threshold a module needs lives in
`packages/config/src/modules/<module>.ts`, one file per module, exported through the package's
`./modules/*` subpath (`@nabvy/config/modules/<module>`) and imported nowhere else. A module file:

- validates its values with a Zod schema at load, the same way `env.ts` validates variables, so a
  malformed constant fails at start-up rather than at first use;
- carries a comment on each value's basis (a cited measurement or rule) and marks it a starting
  value until the module's fixtures calibrate it;
- is read only through `@nabvy/config`; a module never re-defines its own thresholds locally.

`packages/config/src/modules/cost-meter.ts` is the first: `APIFY_SETTLE_DELAY_MS` and
`MODEL_PRICES_NANO_USD`, moved from `services/cost-meter/src/config.ts` (task 0.8).

## Decisions

- **Groups, not one schema.** Variables are grouped by the part of the system that uses them
  (`docs/secrets.md`, "Used by"). A service loads only its groups, so it fails fast on its own
  missing variables and is not blocked by secrets that belong to a later phase.
- **Fail fast, safely.** `loadEnv` throws `EnvError` listing every missing and malformed variable
  at once. The message holds names and reasons, never values, so it is safe to log.
- **Empty means unset.** `.env.example` ships every variable with an empty value; a blank or
  whitespace-only value counts as missing, never as a valid empty string.
- **Defaults only where docs/secrets.md states a value.** `CEX_API_BASE`, `CEX_DAILY_CAP_CALLS`,
  the three `MODEL_*` IDs, `POSTCODES_IO_BASE`, `POSTHOG_HOST`, the three spend caps,
  `EBAY_INSIGHTS_ENABLED` and `LIVE_PROVIDERS` have defaults. `USD_GBP_RATE` and `ADMIN_EMAILS` are
  configuration without a default. Secrets never have defaults; a test proves that every other
  variable is missing from an empty environment.
- **`USD_GBP_RATE` has its own group.** It sat in `apify` with `APIFY_TOKEN`, but the token is an
  Edge Function secret read only by `apify-gateway` (`CLAUDE.md`), so no pipeline module could load
  that group just for the rate (`docs/questions.md`, "cost-meter: USD_GBP_RATE outside the apify
  group"). It is now its own `exchangeRate` group, loadable on its own (task 0.8).
- **URL checks.** Provider endpoints must be `https://`. The app's own URLs (`BETTER_AUTH_URL`,
  `SUPABASE_URL`) may be `http://` so local development (`supabase start`, Next.js) works, but must
  have a scheme and a host.
- **Later choices get their own group.** The Facebook fallback actor and the Gumtree actor are
  chosen after week one, so they sit in `apifyFacebookFallback` and `apifyGumtree` and are
  required only by the adapters that use them. `FOUNDER_TELEGRAM_CHAT_ID` is in `founderTelegram`
  because only the Phase 1 dispatcher needs it. `EBAY_RUNAME` (`ebaySell`, Phase 3) and
  `EBAY_EPN_CAMPAIGN_ID` (`ebayPartnerNetwork`, after approval) are kept out of the Phase 2 Browse
  group. The actor brief allows only one Facebook actor, so `apifyFacebookFallback` may go when the
  build pack is rewritten (`docs/decisions.md`, "Precedence").
- **Test-time variables.** Turborepo passes `LIVE_PROVIDERS` (hashed into the cache key) and the
  two database URLs through to `pnpm test`; `tsconfig.base.json`, `.env.example` and
  `docs/secrets.md` are global cache inputs, so editing them re-runs the checks.
- **Drift is a test failure.** Tests check that the schema, `docs/secrets.md`, `.env.example` and
  the test fixture list the same variables.

Model price table, usage list prices, rate limits and caps from `docs/engineering.md` arrive with
the tasks that first use them.
