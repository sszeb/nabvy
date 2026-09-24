# @nabvy/scan-recognition

Identifies an item the user scanned: barcode first, then a CeX box lookup, otherwise one vision
call per scan whose candidates are resolved through the catalogue (`docs/design/modules/scan-recognition.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). Off: scan mode is unavailable;
`scan()` and `confirm()` return `scan-recognition.off` and write nothing, and both views are
empty. Shadow: scans run and write, `v_scans` has rows, `v_user_scans` has none. Photo scans also
fail closed (`scan-recognition.paid_work_paused`) while `cost-meter` or the `anthropic` provider
switch is off; barcode scans still work. With `product-catalogue` off, every candidate resolves to
nothing and photo scans come back unidentified. MVP (`docs/decisions.md:85,95`), backlog BP3.

## Inputs

- The scan form (`ScanRecognitionScanInput`): a client-generated `scanId`, the user, an optional
  EAN/UPC and an optional photo already uploaded under `scans/<userId>/`. The scan procedure checks
  the session and starts a task that calls `scan()` inside `withPipeline`, because it reads
  product-catalogue and writes cost-meter, which only the pipeline may.
- `confirm()` from the scan procedure inside `withUser`.
- Functions read: `@nabvy/switches` `state`, `isOn`; `@nabvy/account` `isActive`;
  `@nabvy/product-catalogue` `lookupByCode` (`ean`, `cex_box`) and `resolve`; `@nabvy/cost-meter`
  `contextFor`, `recordModelCall` and its price table.
- Soft: `cex-adapter`'s box lookup, passed in as `cexBoxLookup`; absent in the MVP.
- Event consumed: `account.deleted` v1 (`onAccountDeleted`).
- Caller-supplied config: `SCAN_SPEND_CAP_MINOR` (`spendCaps`) and `USD_GBP_RATE` (`exchangeRate`).

## Outputs

- **Event** `scan-recognition.identified` v1 `{ scanId }`, keyed
  `scan-recognition.identified:<scanId>@<catalogueId>`; returned to the caller to publish after
  its transaction commits. Emitted when a barcode resolves, the model's top candidate reaches the
  threshold, or the user confirms.
- **Internal view** `scan_recognition.v_scans` (`nabvy_pipeline`; rows while not off): `id, user_id,
  method, status, identified, confidence, confirmed, model_called, at, identified_at`.
- **User-facing view** `scan_recognition.v_user_scans` (`nabvy_app`, own rows by RLS, rows only
  while on): `id, method, status, identified, candidates, confidence, confirmed, search_phrases, at`.
- **Functions**: `scan(q, input, deps, ctx)`, `confirm(q, input)`, `expirePhotos(q, now, limit)`,
  `onAccountDeleted(q, payloads)`, `createRecordedVisionClient(model, recordings)`, and the
  `ScanVisionClient` interface.

## Tables

`scan_recognition.scan_events`: primary key `id` (the client's scan ID); `user_id`, `barcode`,
`photo_ref`, `photo_media_type`, `photo_expires_at`, `method` (`barcode | cex_box | vision |
none`), `status` (`identified | needs_confirmation | unidentified`), `identified`, `candidates`
(at most three catalogue IDs), `confidence`, `confirmed`, `description` (the model's facts),
`search_phrases`, `model_called`, `model_ref`, `output_valid`, `prompt_version`,
`cost_gbp_micros`, `at`, `identified_at`, `confirmed_at`. Checks keep `identified` one of
`candidates`, the status consistent with it, and the photo under the user's own path. RLS per user;
`nabvy_app` may update only the confirmation columns.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Confirmation threshold | below 0.8 asks the user | `docs/scan-mode.md`, "Identify" | Fixed by the spec |
| Spend cap | `SCAN_SPEND_CAP_MINOR` (default 5p) per user, rolling 24 h | Card; `docs/decisions.md:101` | Starting value (question) |
| Worst-case call | 2,500 input + 600 output tokens | Image token estimate at 1.15 MP plus prompt; `max_tokens` | Starting value |
| Photo retention | 30 days | `docs/security.md:31` | Fixed by the spec |
| Photo upload | JPEG, PNG or WebP, at most 10 MB | `docs/security.md:24` | Fixed by the spec |
| Candidates | at most 3, resolved through the catalogue | `docs/scan-mode.md`, "Identify" | Fixed |

## Fixtures and pass rate

Stage `recognition` (`test/fixtures/recognition.fixtures.ts`), 10 synthetic cases in
`test/fixtures/cases/`, built from the recognition contract with part names the gpu-pc pack's
dictionary resolves: EAN lookup with no model call; unknown EAN falls through to the photo; model
identified; exactly at 0.8; needs confirmation (a family-only name dropped); an output carrying a
sticker price quarantined; an item not in the catalogue; a prompt-injection photo; unknown barcode
without photo; a scan past the cap refused before any call. Pass rate 10/10 (2026-09-24). No real
scans are recorded yet: there is no vision key.

Other tests: `domain.test.ts` (threshold and cap boundaries, ranking, output and input schemas),
`scan.test.ts` (metering, what reaches the model, server-stamped time, cap window, invalid
output still charged, restricted account, unpriced model,
failed call, reused scan ID, CeX lookup, confirmation, RLS and column grants, photo expiry),
`idempotency.test.ts`, `switch.test.ts`, `contracts.test.ts`, and
`packages/db/tests/scan-recognition.test.sql` under `pnpm db:dry-run`.

## Decisions

- 2026-09-24: **The model client is an interface** (`ScanVisionClient`) with one implementation
  that replays recorded responses, because no Anthropic key exists yet. A real client downscales
  the photo to 1.15 MP, uses temperature 0, `max_tokens` = 600 and the Zod output schema, and
  sends no user or scan ID.
- 2026-09-24: **The model never chooses a catalogue ID.** It names candidates in words; each name
  goes through product-catalogue's `resolve()`, and only a match naming one catalogue item (not a
  family with the variant unstated) becomes a candidate.
- 2026-09-24: **No price anywhere.** The output schema is strict and has no sticker price, so an
  output carrying one is quarantined; no column holds a price (question).
- 2026-09-24: **One vision call per scan, no retry.** An invalid output leaves the scan
  unidentified with `output_valid = false` (question).
- 2026-09-24: **Idempotency key is the client's scan ID.** A replay returns the stored scan with the
  same event key and never calls the model or the meter again; the same ID with other input is
  `scan-recognition.conflict`. A per-user advisory lock serialises one user's scans, so two
  concurrent scans cannot both pass the cap on the same budget.
- 2026-09-24: **Cap before the call.** The worst-case cost is priced from cost-meter's table and
  converted at `USD_GBP_RATE`; the scan is refused when it would take the user's window spend past
  the cap. The actual cost is recorded through `recordModelCall` and stored on the scan. If the
  meter refuses after the call (an invariant break: its state and price were checked first), the
  scan is still stored and counted, and `unmetered` is set so the task commits and raises an
  incident instead of rolling back and paying again.
- 2026-09-24: **Server time only** (review of PR #41). The scan form carries no client time; the
  row's `at` and `photo_expires_at` are stamped from server `now`, so a late task run or a forged
  time can neither hide spend from the cap window nor stretch or cut the 30-day photo rule.
- 2026-09-24: **Run `scan()` in a transaction.** The per-user lock is a transaction-scoped
  advisory lock, so the cap is race-free only inside `withPipeline`, and the lock (and the
  transaction) is held across the vision call. If that transaction later rolls back, or the call
  throws after the provider billed it (a timeout), the call is not recorded; the provider's own
  usage is then the record of it. Known gap until a real client exists.
- 2026-09-24: **The worst-case estimate is not a hard bound on input.** `max_tokens` bounds output;
  input is bounded only by the client downscaling to 1.15 MP, so a larger image can pass the cap
  by a fraction of one call. The actual cost is always recorded and counted.
- 2026-09-24: **`confirm()` only while on.** In shadow the user sees no scans, so nothing to confirm.
- 2026-09-24: **User-facing view in this module's schema** until an `app` schema exists (question).
- 2026-09-24: **Photo expiry** clears the ref after 30 days and returns it for the storage task
  to delete; the storage lifecycle rule is the backstop. No inventory exemption yet (question).

## Open questions

- `docs/questions/scan-recognition.md`: the cap's meaning, the view's schema, spend-governor, the
  sticker price, no retry, the CeX lookup, inventory photos, the `anthropic` switch.
- Legal: `docs/legal-review.md` row 11 already lists scan photos and their processing by an AI
  model (card question 12).

## Incidents

None.
