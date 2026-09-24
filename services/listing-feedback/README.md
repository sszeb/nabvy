# @nabvy/listing-feedback

Records a user's verdict on a listing (`real_deal`, `not_a_deal`, `bought`) and their saved or
dismissed state (`docs/design/modules/listing-feedback.md`).

A module session edits only this folder, `packages/contracts/src/modules/listing-feedback.ts`,
`packages/db/src/schema/listing-feedback.ts`, `packages/db/tests/listing-feedback.test.sql` and
`packages/db/migrations/listing-feedback/`.

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). Off: `recordVerdict` and `setState`
both refuse (`listing-feedback.off`), nothing is written, and both `v_verdict_counts` and
`v_listing_feedback_mine` are empty. Users lose the deal-card feedback controls and the "saved"
list; nothing else changes (`alert precision` gets no new data, but stops computing rather than
failing). Shadow: recording still writes — a write is a command, not a read, and this module has
no batch work for "off" to stop — so `v_verdict_counts` has rows, but `v_listing_feedback_mine`
stays empty until the switch is `on`. MVP, BP4 (`docs/backlog.md:58`).

## Inputs

- Web forms through oRPC procedures inside `withUser`: `recordVerdict` and `setState`.
- `account.deleted` (`account`), handled by `onAccountDeleted`: purges the user's rows.
- `listing_suppression.is_suppressed(listing_id)` (`listing-suppression`), called from
  `v_listing_feedback_mine` only: a suppressed listing never reaches the user-facing view (rule 5
  of `docs/design/modules/_rules.md`).
- `better_auth.account_active`/`account_restriction` (`auth`, through `@nabvy/account`'s
  `isActive`): both write functions refuse for a suspended or banned account (rule 12).

## Outputs

- **Event** `listing-feedback.recorded` v1 `{ verdictIds }` (1 UUID per call): the verdict row's
  ID, published by the caller after its transaction commits. Key
  `listing-feedback.recorded:<verdictId>@<verdict>` (rule 8: natural ID plus its current value), so
  a replay republishes the same key and a changed verdict publishes a new one. Never emitted for a
  saved/dismissed state change. The `alert_feedback` analytics event (`docs/web-app.md:54`) is
  recorded by the calling procedure through `product-events`, not here.
- **Internal view** `listing_feedback.v_verdict_counts` (`nabvy_pipeline`; `security_invoker`; rows
  while shadow or on): `alertId`, `day`, `verdict`, `n` — verdicts per alert, day and verdict, with
  no user ID (an alert precision guardrail metric, `docs/decisions.md:236`, and the review loop).
- **Internal view** `listing_feedback.v_bought_for_reports` (`nabvy_pipeline`; meant only for
  `seller-reply-reports`, the report-then-buy abuse exemption, too-good-to-be-true design §3.3,
  §6.1, task 1.7s): `userId`, `listingId`, `at` — every current `bought` verdict. Carries a user ID
  but no seller field, so it is the plain internal class of rule 5, not `restricted_`; until
  per-module roles exist it is granted to `nabvy_pipeline` like every other internal view (rule 4).
- **User-facing view** `listing_feedback.v_listing_feedback_mine` (`nabvy_app`; `security_invoker`;
  rows only while `on`): `listingId`, `alertId`, `verdict`, `state`, `at` — the caller's own
  feedback, one row per verdict and one per state (exactly one of `verdict`/`state` is set). Lives
  in this module's schema, not `app.*`, because no `app` schema exists yet — the same gap
  `services/account/README.md` and `services/scan-recognition/README.md` record for their own
  modules; move it once the web app's oRPC layer creates `app`.
- **Functions** (`@nabvy/listing-feedback`): `recordVerdict(q, input, { now? })` → `Result`,
  `setState(q, input, { now? })` → `Result`, `onAccountDeleted(q, payloads)`.

## Tables

Schema `listing_feedback`:

- `verdicts`: `id` (UUID v7), `user_id`, `listing_id`, `alert_id` (nullable: absent when the
  feedback was not given from an alert), `verdict` (`real_deal | not_a_deal | bought`), `at`.
  Unique on `(user_id, listing_id, coalesce(alert_id, nil))` (`verdicts_identity_idx`): the
  identity a call upserts on, so the same or a changed verdict for the same listing (and alert, if
  any) is always one row. Row-level security on `user_id`.
- `listing_state`: `id`, `user_id`, `listing_id`, `state` (`saved | dismissed`), `at`. Unique on
  `(user_id, listing_id)`: one state per user per listing, the latest call wins. Row-level security
  on `user_id`.

Neither table carries a foreign key into another module's schema (rule 4): `listing_id` and
`alert_id` are plain values, unchecked against `listing-ingest` or an alerts module.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Verdict values | `real_deal`, `not_a_deal`, `bought` | `docs/backlog.md:58`; `docs/web-app.md:30`; the build pack's `Alert.userVerdict` (`docs/contracts.md:112`) | Fixed |
| State values | `saved`, `dismissed` | `fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:145` | Fixed |
| Identity | `(user_id, listing_id, alert_id)` for a verdict, `(user_id, listing_id)` for a state; a null `alert_id` is its own identity, not merged with a real one | Card: "verdicts (user_id, listing, alert_id, verdict, at)" | This module's reading (question below) |
| A verdict is never a sale price | Enforced by the schema: no price column anywhere in this module | `docs/decisions.md:16` | Fixed |

## Fixtures and pass rate

Stage `record` (`test/fixtures/record.fixtures.ts`), 5 synthetic cases (no recorded Facebook run
needed: this module never reads listing content, only the user's own action) — `repeat-verdict`,
`change-verdict`, `alert-and-no-alert`, `save-then-dismiss`, `bought-then-changed`. Pass rate 5/5
(2026-09-24).

Other tests: `test/domain.test.ts` (the event key), `test/idempotency.test.ts` (a repeated or
changed verdict/state writes one row; a verdict with and without an alert are separate rows),
`test/switch.test.ts` (off refuses and empties both views; shadow writes with internal rows only;
on shows the user's own feedback), `test/rls.test.ts` (a user cannot read, update or insert as
another user; `v_verdict_counts` carries no user ID; a suppressed listing never reaches
`v_listing_feedback_mine`), `test/purge.test.ts` (`account.deleted` purges the user's rows,
idempotently, de-duplicating a batch), `test/contracts.test.ts` (the event and every view row
parse), and `packages/db/tests/listing-feedback.test.sql` (grants, the constraints, RLS isolation,
the switch filter on both views, and the suppression filter, on real Postgres — `pnpm db:dry-run`).

## Decisions

- **2026-09-24: writes run entirely as `nabvy_app` inside `withUser`.** Unlike `scan-recognition`,
  neither `recordVerdict` nor `setState` needs a pipeline-only read (no cost-meter, no
  product-catalogue), so there is no reason to write as `nabvy_pipeline`: RLS is the only isolation
  a caller needs. `nabvy_pipeline` only purges a deleted account's rows and reads for the two
  internal views.
- **2026-09-24: a null `alert_id` is folded into the nil UUID for the identity index**
  (`verdicts_identity_idx`, `coalesce(alert_id, '00000000-…-000000000000'::uuid)`), so one `ON
  CONFLICT` target covers both "from an alert" and "not from an alert" without two upsert paths.
  Never stored as a real `alert_id`: a check constraint refuses it.
- **2026-09-24: a state change publishes no event.** The card names only
  `listing-feedback.recorded` (verdict IDs); a saved/dismissed toggle is not an alert-precision
  signal and nothing downstream reads it as an event yet.
- **2026-09-24: `v_bought_for_reports` is a plain internal view, not `restricted_`.** Rule 5's
  restricted class exists for seller columns; this view carries a user ID but no seller field.
  Until per-module roles exist it is granted to `nabvy_pipeline` like every other internal view,
  same as `listing-suppression`'s `v_suppressed` (rule 4).
- **2026-09-24: no FK into `listing-ingest` or an alerts module.** `listing_id` and `alert_id` are
  plain values (rule 4); a caller can name a listing this module has never heard of. The view still
  filters correctly because `is_suppressed()` treats an unknown listing as not suppressed.

## Open questions

None (card: "Open questions: none").

## Incidents

None.
