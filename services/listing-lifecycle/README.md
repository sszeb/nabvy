# @nabvy/listing-lifecycle

One atomic module (`docs/decisions.md`, "Atomic modules"). A module session edits only this
folder, `packages/contracts/src/modules/listing-lifecycle.ts`, `packages/db/src/schema/listing-lifecycle.ts` and
`packages/db/migrations/listing-lifecycle/`.

## Job

TODO: the one function this module does, in a sentence or two.

## Inputs

TODO: events consumed (with their producing module) and the `v_` views or exported functions read.

## Outputs

TODO: what it produces and for whom.

## Owned tables

Postgres schema `listing_lifecycle`. TODO: each table, one line on what a row is.

## Views

TODO: each `v_` view other modules or users read, and its field allowlist. Views are
`security_invoker` and never expose seller identity or the raw provider row
(`packages/db/README.md`, "Views").

## Events

TODO: events published (declared in `packages/contracts/src/modules/listing-lifecycle.ts`), each with its
idempotency key and the T-timestamp it stamps.

## When switched off

TODO: what stops, and how modules reading this one's output carry on without it.

## Tests

TODO: the fixtures used and what the tests prove. Unit tests: `pnpm --filter @nabvy/listing-lifecycle test`.
Fixture stages go in `test/fixtures/<stage>.fixtures.ts` with their recorded pass rates in
`test/fixtures/pass-rates.json` (`fixtures/README.md`, "Runner"); `pnpm test:fixtures` runs them.

## Decisions

TODO: anything decided while building this module.
