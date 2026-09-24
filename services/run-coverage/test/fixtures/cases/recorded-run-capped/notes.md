# recorded-run-capped

The recorded newest check (run-summary.json:4-21): route `http`, stop `results-limit` (our `maxListings` of 20), one page, 20 listings, binding verified. Our own cap stopped it, so it is `capped`, not complete and not degraded (actor-integration.md 2.9; README.md:101). No previous check, so no gap check. A newest check always stops at a cap, so its first healthy capped read is the scope's bounded baseline.
