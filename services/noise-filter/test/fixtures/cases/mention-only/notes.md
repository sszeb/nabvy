# mention-only

Synthetic, built from five recorded PC sales (`only`), with the search terms and descriptions
edited. The mention phrases are the evidence ledger's "5080" examples ("upgraded to a 5080",
"waiting for my 5080"; `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:556-559`), the cases behind
"12 of the 14 description-only 5080 mentions were not offers" (`fb-scrap-engine/docs/HANDOFF.md:171-173`),
which are not in the fixtures tree (the recorded run searched "gaming pc").

- `1072745435569624`: found by "rtx 5080"; an RTX 2070 Super PC, "Upgrading to a 5080": the only
  part naming 5080 is a mention, so `mention_only`.
- `1397200465308431`: found by "5080" and "gaming pc"; "Waiting for my 5080": 5080 is a mention,
  but the generic term keeps it a candidate, so no reason.
- `1403975981250476`: found by "5080"; "#rtx5080" sits only in a hashtag block that parts-rules
  ignored: `keyword_stuffing`.
- `1783301919382894`: found by "5080" but never names it: `absent`, unknown, never noise.
- `2264485254402498`: found by "rtx 5080"; an RTX 5080 build: `offered`, no reason.
