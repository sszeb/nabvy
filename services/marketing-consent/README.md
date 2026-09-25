# @nabvy/marketing-consent

Keeps marketing consent, preferences and email suppressions, and gates every marketing send
(`docs/design/modules/marketing-consent.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row exists yet, so
`switches.state('marketing-consent')` reads `off` until an admin turns it on). Off:
`canMarket()` fails closed to `false` for every category (module card, "When off": "no marketing
sends"); service messages never call `canMarket()` and are unaffected. **Writes are never gated by
this switch**: `setPreference()`, `pauseAll()`, `resumeAll()`, `recordSuppression()`,
`subscribeNewsletter()` and `unsubscribeNewsletter()` all keep recording regardless of the switch
state (README.md, "Decisions", below) — the same fail-safe reasoning rule 11 gives
`listing-suppression` ("an address that should not be mailed stays suppressed even while the
module is off"). MVP, wave 3, backlog task 4.10 (split from 4.6b).

## Inputs

- Forms: the preference centre (`setPreference`, `pauseAll`, `resumeAll`) and newsletter sign-up
  (`subscribeNewsletter`, `unsubscribeNewsletter`), through a future oRPC procedure or public route
  (`docs/questions/marketing-consent.md`).
- Resend and PostHog bounce and complaint webhooks, normalised to `MarketingConsentSuppressionEvent`
  by a future webhook route and passed to `recordSuppression()` (`docs/questions/marketing-consent.md`).
- Consumes `account.deleted` (module: `account`): purges this module's `marketing_consents` rows
  for the deleted user (rule 12 of `_rules.md`).
- Reads: `@nabvy/switches`' `isOn(q, 'marketing-consent')`; `@nabvy/account`'s `isActive(q, userId)`.

## Outputs

- **`canMarket(q, { userId, email, category })`**: whether a marketing message in `category` may
  go to `userId` at `email`, right now (module card, "Outputs"). The gate every marketing send
  checks.
- **Internal view** `marketing_consent.v_consents` (user_id, category, granted, until, source, at):
  every consent and pause row, while the switch is not off (rule 11). No user-facing view yet
  (`docs/questions/marketing-consent.md`: no `app` schema exists).
- **Functions** from `@nabvy/marketing-consent`: `canMarket`, `getPreferences`, `setPreference`,
  `pauseAll`, `resumeAll`, `isSuppressed`, `recordSuppression`, `subscribeNewsletter`,
  `unsubscribeNewsletter`, `purgeUser`, `accountDeletedHandler` (the wrapped event handler a
  Trigger.dev task file calls with `{ transaction: withPipeline }`).
- Publishes no events of its own (module card, "Outputs": only `canMarket()`).

## Owned tables

Postgres schema `marketing_consent`.

- `marketing_consents`: `user_id` + `category` (primary key). `category` is one of the four
  preference-centre categories (`tips`, `offers`, `product_updates`, `weekly_digest`) or the
  reserved pseudo-category `all`, this module's own record of a "pause all marketing for 30 days"
  action (`docs/questions/marketing-consent.md`). `until` is set only on an `all` row (a check
  constraint refuses it on a real category); no row for a category means "not granted"
  (`docs/marketing.md`: "Sign-up shows an unticked box").
- `email_suppressions`: `email_hash` (primary key, sha256 hex of the trimmed, lower-cased
  address — never the plain address, `docs/marketing.md`'s own table shape), `reason`
  (`bounce | complaint | unsubscribe | manual`), `source` (`resend | posthog | user | admin`), `at`.
  A repeated report for the same address overwrites the row rather than appending one.
- `newsletter_subscribers`: `email_hash` (primary key, same hashing), `consent_source`, `at`,
  `unsubscribed_at`. Hash-only, matching `docs/marketing.md`'s own table shape: the actual send
  list is assumed to be the provider's own audience, not read back out of this table
  (`docs/questions/marketing-consent.md`).

## Views

`marketing_consent.v_consents` (user_id, category, granted, until, source, at): internal, granted
to `nabvy_pipeline` only until a module declares `marketing-consent` as a dependency and gets its
own role (`packages/db/README.md`, "One Postgres schema per module"). `security_invoker`; no
seller identity or raw provider row (there is none in this module).

## Events

None published (module card, "Outputs"). Consumes `account.deleted` (module: `account`);
`marketing-consent` sits outside the T0–T7 chain (rule 10 of `_rules.md`), so its handler stamps no
T-timestamp.

## When switched off

`canMarket()` returns `false` for every category, so nothing built on it sends marketing. Service
messages are untouched: they never call `canMarket()`. Every write function keeps working (the
preference centre, suppression recording and newsletter sign-up are records, not sends), and
`v_consents` returns no rows.

## Tests

`pnpm --filter @nabvy/marketing-consent test`:

- `test/domain.test.ts`: pure logic (`normaliseEmail`, `hashEmail`, `isPaused`, `isGranted`,
  `decideCanMarket`), including the pause boundary (`until` equal to now is lapsed) and every
  `canMarket` branch.
- `test/contracts.test.ts`: `MarketingConsent` matches `v_consents`'s columns; the module publishes
  no events; `canMarket`'s input schema normalises and validates the email and category.
- `test/switch.test.ts`: off/on behaviour of `canMarket()` and the view; writes still succeed while
  off.
- `test/idempotency.test.ts`: `setPreference`, `recordSuppression`, `subscribeNewsletter` /
  `unsubscribeNewsletter` and `pauseAll`/`resumeAll` each run twice with no duplicate effect.
- `test/handlers.test.ts`: `accountDeletedHandler` purges a deleted user's rows and is idempotent
  on replay.
- `test/fixtures/can-market.fixtures.ts` (stage `can-market`, 6/6): the module's own acceptance
  test, "a suppressed address is never sent to" (module card, "Tests and fixtures";
  `docs/modules.md:107`), plus the golden path, no consent, the module off, an active pause and a
  banned account. All synthetic (there is no recorded Facebook run to build consent fixtures from).
- `packages/db/tests/marketing-consent.test.sql` (in `pnpm db:dry-run`): RLS isolation on
  `marketing_consents`; grants on all three tables (nabvy_app has none on the two email-hash
  tables; nabvy_pipeline never deletes a suppression or subscriber row); the check constraints; the
  `v_consents` column list, switch filter and reader grant.

## Decisions

- 2026-09-24: `canMarket()` takes `{ userId, email, category }`, not the card's literal
  `(userId, category)`, because this module has no way to resolve a user's email from `userId`
  alone (`docs/questions/marketing-consent.md`).
- 2026-09-24: "pause all marketing for 30 days" is a row in `marketing_consents` under the reserved
  category `all`, not a fourth table (`docs/questions/marketing-consent.md`).
- 2026-09-24: `canMarket()` also checks account standing through `@nabvy/account`'s `isActive()`
  (rule 12 of `_rules.md`), which is why the card's "Depends on" line names `auth` and `account`
  even though its "Outputs" line names only `canMarket()` (`docs/questions/marketing-consent.md`).
- 2026-09-24: writes (`setPreference`, `pauseAll`, `resumeAll`, `recordSuppression`,
  `subscribeNewsletter`, `unsubscribeNewsletter`) are never gated by this module's own switch; only
  `canMarket()` fails closed. A user's own consent choice, and an address that must never be
  mailed again, are records this module always takes.
- 2026-09-24: no `app.*` user-facing view yet, following `account`'s own precedent — the oRPC layer
  is a separate, not-yet-built pull request (`docs/questions/marketing-consent.md`).
- 2026-09-24: `email_suppressions` and `newsletter_subscribers` are never purged on
  `account.deleted`: they carry no `user_id` (an address may belong to a non-user, e.g. a public
  daily-brief subscriber) and hold only a hash, and a suppression must survive account deletion so
  the address is never mailed again. Only `marketing_consents` (which does carry `user_id`) is
  purged, by `accountDeletedHandler`.
- 2026-09-24: Resend and PostHog accounts do not exist yet, so `recordSuppression()`'s push into
  the other provider's own suppression list goes through the `SuppressionSyncClient` interface,
  with `InMemorySuppressionSyncClient` as the only implementation
  (`docs/questions/marketing-consent.md`).

## Open questions

- `docs/questions/marketing-consent.md`, "canMarket()'s signature needs the target email".
- `docs/questions/marketing-consent.md`, "pause all marketing for 30 days is a pseudo-category".
- `docs/questions/marketing-consent.md`, "canMarket() also checks account standing".
- `docs/questions/marketing-consent.md`, "email_suppressions and newsletter_subscribers store only a hash".
- `docs/questions/marketing-consent.md`, "no app.* user-facing view yet".
- `docs/questions/marketing-consent.md`, "the webhook payload shape is this module's own contract".

## Incidents

None.
