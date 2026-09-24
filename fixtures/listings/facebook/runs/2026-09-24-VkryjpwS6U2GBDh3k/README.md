# Facebook actor run VkryjpwS6U2GBDh3k (2026-09-24)

The first recorded response of the private actor `YfdUav3sZ2BgEf8rh` (build 1.0.82), run by hand
for task 1.0 through the `apify-gateway` Edge Function (gateway job 6).

- **Search.** "gaming pc", Chichester centre (`cityId` 115935195086622; Facebook reported a 65 km
  radius around 50.836, −0.775). Newest first, page 1, details on (graphql route).
- **Result.** 20 listings and 1 `sourceOutcome` row. 22 Facebook requests, 25 s. Settled cost
  $0.0177.
- **Freshness observed.** The feed was in newest-first order. At collection (01:40 UTC) the newest
  listing was 16.6 hours old and the oldest on page 1 was 33.7 hours old.

## Files

| File | Contents |
| --- | --- |
| `input.json` | The exact actor input and the Apify run options (memory, timeout) |
| `dataset.json` | The run's dataset rows, redacted (see below), in dataset order |
| `run-summary.json` | The run's `RUN_SUMMARY` record (no redaction was needed) |
| `run.json` | Apify run metadata: status, build, timings, stats, usage, settled cost |

## Redaction

Produced by `apify_gateway.redacted_items(6)` in Supabase (`supabase/README.md`), so raw seller
data never left the database. `apify_gateway.redaction_leaks(6)` returned nothing.

- **Seller objects.** All 9 (3 listings × `seller` and its two copies in `sourceFields`) are
  same-shaped placeholders:
  - the one numeric ID is `9` followed by the row number, zero-padded to the original length;
  - the two token IDs are `redacted-token-<row>`;
  - names are `[redacted]`, and pictures point to `https://redacted.invalid/`.
- **Media links.** Every Facebook media URL (photos, thumbnails) is replaced by
  `https://redacted.invalid/media/<first 12 hex of md5(url)>.jpg`, so the same photo still matches
  across fields.
- **Listing text.** Emails, phone numbers, social handles and links are masked; none occurred.
  One business's full postcode keeps only its outward code. That business's trade name was also
  replaced by `[business name redacted]` at export (the one manual change).
- **Kept.** Listing IDs, listing URLs, titles, descriptions, prices, categories, town labels and
  coarse coordinates. They are what the fixtures test.

## Verification

After export, each of the 21 rows was re-serialised the way Postgres prints `jsonb`, and its MD5
compared with the database's. All 21 match, and so do the combined checksum
(`e5bbfc0138ed5af0a276ceb49c70dbc2`, rows joined by newlines) and the checksums of the input, run
options, run metadata and summary. Formatting by Biome changed layout only.
`services/source-adapters/test/fixtures/adapter.facebook-run.fixtures.ts` checks the fixture on every
`pnpm test:fixtures` run.
