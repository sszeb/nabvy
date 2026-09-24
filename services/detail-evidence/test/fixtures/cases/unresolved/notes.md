# unresolved

Synthetic, built from the actor's documented shape for a removed ID: a row with
`directItemUnresolved: true` and `detailOutcome: "extraction-error"` (docs/fb-actor-reference.md,
`directItemUnresolved`; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:254-255; verified on v2 only).

After the recorded run, a details run of three IDs: `1123980543398026` (resolved, same text),
`1072745435569624` (known, now unresolved) and `4704995303122642` (never ingested, unresolved;
the README's example item ID). listing-ingest does not run on this job (the known listings are
already stored). Expected: three fetches, no new version, `1072745435569624` announced as
`unresolved` (never as sold), its last version still current, and the never-ingested ID recorded
without a listing ID and not announced.
