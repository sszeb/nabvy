# @nabvy/contracts

Zod schemas and inferred types for everything that crosses a boundary: events, fact templates,
the pack format, oRPC input and output, and model output (`docs/contracts.md`). Tables are not
typed here: `packages/db` owns persisted shapes, and a module derives table schemas from Drizzle
rather than writing them twice (`docs/engineering.md`, "Rule of two").

This package holds the **shared core** (task 0.2–0.3 foundation). Each atomic module adds its own
contracts in its own file (`docs/decisions.md`, "Atomic modules").

## Layout

```
src/
  index.ts              the shared core, imported as '@nabvy/contracts'
  core/                 ids, money, time and T-stamps, enums, events, the listing stub, results
  modules/<module>.ts   one file per module, imported as '@nabvy/contracts/modules/<module>'
test/                   core tests, fixture round-trips, cross-module checks
fixtures/contracts/     (repository root) sample objects, see "Fixtures"
```

There is **no shared index of modules**. Each module file is reached through the subpath export
`./modules/*`, and the tests discover module files at run time. A module branch adds its file
(created by `pnpm new:module <name>`) and its fixtures and edits nothing shared.

## Shared core

| Export | What it is |
| --- | --- |
| `Uuid`, `UuidV7`, `uuidv7()`, `brandedId('HuntId')` | Row IDs are database-generated UUID v7 (`nabvy_core.uuidv7()`); `Uuid` accepts any version because Better Auth user IDs are v4. `uuidv7()` is for IDs Nabvy makes in code, such as event IDs. Brand per entity in the module's file |
| `Currency`, `Money`, `moneyIn('EUR')`, `money()`, `addMoney`, `subtractMoney`, `compareMoney` | Integer minor units with an ISO code, `GBP` or `EUR`. They are never converted or mixed: the arithmetic throws `CurrencyMismatchError`, and `moneyIn` types a group to one currency (`docs/decisions.md`, Precedence, "Region and currency") |
| `IsoTimestamp`, `isoNow()` | ISO 8601 UTC with `Z` |
| `TStampName`, `TStamps`, `stamp()`, `secondsBetween()` | The hop stamps T0 listed … T7 opened (`docs/architecture.md`). `stamp` keeps the earliest value, so a handler that runs twice never moves a stamp |
| `Source`, `DeliveryMethod`, `ListedAtPrecision` | Shared enumerations |
| `ListingStub`, `PriceKind` | What an adapter returns per listing before the registry assigns an ID (`docs/providers.md`). `raw` is the provider's whole row, kept in full; `sellerId` and `raw` are internal only (see "Seller identity") |
| `EventEnvelope`, `defineEvents`, `createEvent`, `parseEvent`, `safeParseEvent`, `latestVersion`, `taskIdFor` | Thin events (below) |
| `listingKey()`, `batchKey()` | Idempotency keys: `source:sourceListingId:contentHash`, and a SHA-256 over a batch's sorted item keys |
| `Result`, `ok`, `err`, `AppError`, `ErrorCode` | Expected failures as values. Codes are `<module>.<code>`, owned by the module that raises them |

## Per-module contracts

`pnpm new:module <name>` creates `src/modules/<name>.ts`:

```ts
import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

export const module = 'copy-advert-spam'

export const SpamVerdict = z.strictObject({ listingId: Uuid, decidedAt: IsoTimestamp, rule: z.string() })
export type SpamVerdict = z.infer<typeof SpamVerdict>

export const events = defineEvents(module, {
  'spam.flagged': { 1: z.object({ listingIds: z.array(Uuid).min(1).max(500) }) },
})
```

Rules:
- The file exports `module` (its own name) and `events` (its registry, even if empty). A test
  checks both names against the file name.
- Import the shared core from `'../index'`. A contract file never imports another module's
  contract file; shared shapes belong in the core (a foundation change, agreed with the
  coordinator).
- Schemas are `z.strictObject` for anything a module receives, so unknown fields fail loudly.
  Derive types with `z.infer`, never write them twice.
- Consumers import the producer's file: `import { events } from '@nabvy/contracts/modules/listing-registry'`.

## Events

Envelope (`docs/contracts.md`, "Events"), plus a payload version `v`:

```ts
{ id: UuidV7, type: 'listing.new', v: 1, at: IsoTimestamp, key: string, payload: {…} }
```

- **Names** are `noun.verb` in lower case. The Trigger.dev task ID is the name with a dash
  (`taskIdFor('listing.new')` gives `listing-new`). Each event type is declared by exactly one
  module, the producer; a test fails if two modules declare the same type.
- **Thin payloads.** `defineEvents` refuses, at import time, any payload field that is not a
  string, number, boolean, enum or literal, or an array of those. Nested objects and records are
  refused because they are how whole records get into events. Carry IDs and timestamps; the
  receiver loads what it needs.
- **Batches.** Payloads carry arrays of IDs (100–500), never one listing per event.
- **Idempotency.** `key` is the handler's idempotency key: `listingKey()` for one listing,
  `batchKey(type, listingKeys)` for a batch.
- **Versioning.** Adding an optional field keeps the version. Anything else (a new required field,
  a removed or renamed field, a changed type) adds the next version beside the old one:
  `{ 1: v1Schema, 2: v2Schema }`. Producers emit `latestVersion()`. Consumers accept every version
  they handle. A version is removed only after every consumer has moved on, in its own pull
  request.
- **Parsing.** Consumers call `parseEvent(producerEvents, raw)` (it throws) or `safeParseEvent`,
  which returns a union typed by `type` and `v`.

## Seller identity

Actor data is kept in full, including seller fields (`docs/decisions.md`, "Actor data kept in
full"). Contracts that reach end users (oRPC output, alert cards, public API) must never carry
seller identity: no seller ID, name, picture or profile link, and no `raw` provider row. Put such
fields only on internal schemas, like `ListingStub`. The database enforces the same rule on `v_`
views (`packages/db/README.md`); the web app's output test arrives with the web app.

## Fixtures

Every schema that crosses a boundary has samples in `fixtures/contracts/`:

```
fixtures/contracts/core/<Export>.<case>.json            parsed by the core export <Export>
fixtures/contracts/<module>/<Export>.<case>.json        parsed by src/modules/<module>.ts
fixtures/contracts/<group>/invalid/<Export>.<case>.json must be rejected
```

`test/fixtures.test.ts` discovers them and checks that each valid sample parses to itself and
survives a JSON round trip unchanged, and that each invalid sample is rejected. Samples are
canonical (no defaults to fill in). Add a module's fixtures in its own folder; the test needs no
edit.

## Decisions

- **One file per module, subpath exports, no generated index.** Parallel branches add files and
  never edit a shared one. Cross-module checks (unique event types, correct names) run over the
  discovered files.
- **Payload version beside the type** (`v`), not in the type name, so task IDs and consumers'
  routing stay stable across versions.
- **`Money` is an object, never a bare number,** and `EUR` exists only as its own currency.
- **`ListingStub.price` is nullable** with a `priceKind`: the actor reports `free`, `unknown` and
  `ambiguous` prices and `$` (USD) asks. A `fixed` ask has a price (never negative); `free` is zero
  or null; `unknown` and `ambiguous` are null, as are `$` asks; the whole row stays in `raw`.
  `url` and `thumbnailUrl` must be `https`. `Money` itself may be negative (margins, refunds).
- **`Uuid` accepts any version** for rows (Better Auth IDs are v4), `UuidV7` for events.
- The build-pack entities in `docs/contracts.md` (Listing, Valuation, Hunt and the rest) are not
  here: their modules add them (re-scoped by "Atomic modules").
