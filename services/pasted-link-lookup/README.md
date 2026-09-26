# @nabvy/pasted-link-lookup

Lets a user paste a Facebook Marketplace item link and get the listing's card from the shared
pipeline, never through a per-user fetch (`docs/design/modules/pasted-link-lookup.md`). The module
takes the listing ID from the link, records a request, answers at once when the card is already
visible with its details, and otherwise puts the ID on the shared details queue, which fetches
through the Apify gateway. This module never fetches a Facebook URL (`CLAUDE.md`, "No scrapers").
A module session edits only this folder, `packages/contracts/src/modules/pasted-link-lookup.ts`,
`packages/config/src/modules/pasted-link-lookup.ts`, `packages/db/src/schema/pasted-link-lookup.ts`,
`packages/db/tests/pasted-link-lookup.test.sql` and `packages/db/migrations/pasted-link-lookup/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row). Off: pasting is unavailable (`submit()`
returns `pasted-link-lookup.off`), `settle()` writes nothing and sends nothing to the queue, and
both views are empty. Shadow: `submit()` still refuses (a paste is a user-facing action that can
cost a fetch; "Decisions"), `settle()` runs, the internal view has rows, the user-facing view has
none. On: the full job. Priority P1 (module card), critical path [cp 4] (coordinator 12).

## Inputs

- Web form: `PastedLinkLookupSubmitInput` (`userId`, `url` of at most 2048 characters), through an
  oRPC procedure that calls `submit()` inside `withUser`.
- `app.v_listing_card` (listing-card): a request's listing is looked up by the card's `link`; a
  card with a `description_status` is "described". Read as `nabvy_app` in `submit()` and as
  `nabvy_pipeline` in `settle()`.
- `listing_suppression.is_suppressed()` (listing-suppression): the user-facing view leaves out a
  request whose listing is suppressed.
- `better_auth.account_active()` through `@nabvy/account`'s `isActive`: a suspended or banned
  account is refused.
- `details_queue.v_queue` through `@nabvy/details-queue`'s `readQueue`: a listing whose text
  fetch has failed for good closes the request as failed.
- `account.deleted` v1 (account): purges the user's requests.

## Outputs

- Event `pasted-link-lookup.ready` v1: `{ requestIds }` (1-500), key
  `pasted-link-lookup.ready:<sha256 of the sorted IDs>`. Published by the caller of `settle()`
  after its transaction commits. Stamps nothing in the T-chain (rule 10): the request's
  `requested_at` and `ready_at` are its own marks.
- Internal view `pasted_link_lookup.v_request_counts` (`user_id`, `day`, `n`): requests per user
  per UTC day, for account-integrity. Granted to `nabvy_pipeline` only.
- User-facing view `app.v_pasted_link_lookup_requests` (`request_id`, `source`,
  `source_listing_id`, `listing_id`, `status`, `requested_at`, `ready_at`): the caller's own
  requests, `security_invoker` over the RLS table, only while this module and listing-suppression
  are on, without suppressed listings. Never the failure outcome, a seller field or listing text:
  the card is read through listing-card by `listing_id`.
- `detailsQueue.enqueue()` (details-queue): called by `settle()` with priority `shortlisted`,
  lane `text`, reason `pasted-link`, once per distinct listing ID per tick.
- Exported functions: `submit(q, input)` (as `nabvy_app` inside `withUser`; returns the request's
  ID, status and listing), `settle(q, { ports? })` (one pipeline tick, as `nabvy_pipeline`,
  inside one transaction; returns what moved and the events to publish), `onAccountDeleted`,
  `parseMarketplaceLink`, `canonicalLink`.

## Tables

Postgres schema `pasted_link_lookup`.

- `requests`: `id`, `user_id`, `source` (`facebook`), `source_listing_id` (1-30 digits, text),
  `listing_id` (listing-ingest's ID once the card is visible; a plain value), `status`
  (`queued`, `ready`, `failed`), `outcome` (`expired`, `fetch-failed`; set exactly when failed),
  `requested_at` (default `now()`), `ready_at` (set exactly when ready), `created_at`,
  `updated_at`. Unique on `(user_id, source, source_listing_id)`: the same link pasted twice by
  one user is one row. RLS on `user_id`; `nabvy_app` may select and insert only, and a
  restrictive policy limits its inserts to `queued` or `ready` rows with `requested_at = now()`
  and `ready_at` null or `now()`, so no caller picks the time the daily limit and the expiry
  count from; `nabvy_pipeline` selects, updates and deletes.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Accepted link | `facebook.com/marketplace/item/<id>/` on `facebook.com`, `www.`, `m.`, `web.`, `mbasic.`, `touch.`; http or https or no scheme; any query or fragment; everything else refused | Module card, "Does / does not"; `CONTAINER_LISTINGS.md:186-188` (user input never chooses URLs) | fixed |
| Listing ID | 1-30 digits, kept as text | `DetailsQueueSourceListingId`; a recorded ID has 17 digits | fixed |
| `PASTED_LINK_LOOKUP_DAILY_LIMIT` | 20 distinct listings per user per rolling 24 h, server time | Each request may cost one paid fetch; `docs/security.md` bounds a free account at £2 a day; the card calls its limit a starting value | starting value (owner's; `docs/questions/pasted-link-lookup.md`) |
| `PASTED_LINK_LOOKUP_REQUEST_TTL_DAYS` | 7 | The details queue defers past-cap work to the next day (`CONTAINER_LISTINGS.md:172-173`), so a request must outlive a few deferrals; a week bounds retries of a removed listing | starting value |
| `PASTED_LINK_LOOKUP_SETTLE_BATCH_SIZE` | 500 queued requests per tick | Rule 9 | starting value |
| `PASTED_LINK_LOOKUP_EVENT_BATCH_SIZE` | 500 request IDs per envelope | Rule 7 | fixed |
| "Described" | `app.v_listing_card.description_status` is not null | listing-card's contract: null until a detail fetch exists | fixed |

## Fixtures and pass rate

Two stages under `test/fixtures/`, both synthetic (this module reads no listing content; the ID
form is the recorded run's 17-digit shape, `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`):

- `link` (21 cases): item URL forms (www, bare host, mobile host, tracking parameters, upper-case
  host, padding, leading zero, 30 digits), and refusals (31 digits, share link, Marketplace
  search, non-numeric ID, trailing path, non-Facebook, the `l.facebook.com` redirector, a
  look-alike host, `fb.com`, plain text, credentials, a port, another scheme).
- `submit` (6 cases): the same link pasted twice makes one row and one queue item; two users make
  two rows and one queue item; an already-described listing is ready at once and queues nothing;
  a known-but-undescribed listing and an unknown listing are queued; a refused link writes
  nothing.

Latest pass rate: `link` 21/21, `submit` 6/6 (`test/fixtures/pass-rates.json`). Other tests:
`test/domain.test.ts` (boundaries), `test/contracts.test.ts`, `test/idempotency.test.ts` (paste
twice, settle twice, out-of-order replay, failed fetch), `test/switch.test.ts`,
`test/rls.test.ts` (cross-user reads and inserts, the restrictive policy, at-once answers, the
daily limit on server time, a restricted account, the purge) and
`packages/db/tests/pasted-link-lookup.test.sql` (`pnpm db:dry-run`).

## Decisions

- **2026-09-25, the queue is written by the settle tick, not by `submit()`.** `details_queue.items`
  is granted to `nabvy_pipeline` only, and `submit()` runs as `nabvy_app` inside `withUser`. So a
  paste records a row and a pipeline tick (`settle()`, a Trigger.dev schedule outside this
  module's files) puts the IDs on the queue in one deduplicated batch, marks ready what the card
  now shows, and closes what expired or failed. "Answers at once" still holds: `submit()` reads
  `app.v_listing_card` itself and inserts the row as `ready` when the card is already described.
- **2026-09-25, the listing is resolved through `app.v_listing_card`, by link.** The card names
  that view as the module's input, `nabvy_app` may read it, and it already applies listing-card's
  switch, the suppression list and the unresolved filter, so no SECURITY DEFINER function of this
  module's own is needed. `canonicalLink()` builds the exact string `app.listing_card()` emits;
  the cost (a scan of the function's output per call) is recorded in the questions file.
- **2026-09-25, `shadow` refuses a paste.** Pasting is a user-facing action that can cost a fetch,
  and rule 11 hides every user-facing row in shadow, so a user could never see the result.
  `settle()` still runs in shadow, so the tick can be watched before the switch goes on.
- **2026-09-25, one request row per (user, listing), whatever its state.** A second paste of the
  same link returns the existing row (`created: false`) and never re-queues a fetch, even after
  the request is ready or failed. Re-asking for a fresh fetch of a listing is a refresh decision
  the card does not make; recorded as a possible follow-up rather than guessed.
- **2026-09-25, server time only.** `requested_at` defaults to `now()`; a restrictive RLS policy
  refuses any other value from `nabvy_app`, as well as a `ready_at` that is not `now()`, a
  `failed` row or an `outcome`. The daily window and the TTL are compared in SQL against `now()`;
  `settle()` takes no clock.
- **2026-09-25, no fetch of any kind.** The only link the module ever builds is the canonical one,
  for a database lookup; nothing here imports an HTTP client or reads Facebook. The details queue
  and the Apify gateway own the fetch.
- **2026-09-25, `nabvy_core.view_violations()` does not scan `app.*` views** (as listing-card
  found). `packages/db/tests/pasted-link-lookup.test.sql` asserts `security_invoker`, the exact
  column list and the grants by hand for `app.v_pasted_link_lookup_requests`.

## Open questions

`docs/questions/pasted-link-lookup.md` (never `docs/questions.md` itself: `docs/session-conventions.md`).

## Incidents

None.
