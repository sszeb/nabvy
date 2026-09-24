# fixtures/contracts

Sample objects for the contracts in `packages/contracts`. `core/` holds samples for the shared
core; `<module>/` holds each module's, added by that module. Files are named
`<Export>.<case>.json`, where `<Export>` is the Zod schema's export name; samples that must be
rejected go in `<group>/invalid/`. `packages/contracts/test/fixtures.test.ts` discovers and
round-trips them all (`packages/contracts/README.md`, "Fixtures").
