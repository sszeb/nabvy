# Fixtures

Fixtures are real listings with hand-labelled expected results. They are the acceptance tests for extraction, risk, valuation and gating. Every change to those modules must keep the pass rate at or above the previous run.

## Layout

```
fixtures/
  contracts/            sample objects for every schema in docs/contracts.md
  listings/<source>/<id>/
    stub.json           the normalised Listing as the adapter produced it
    detail.json         the ListingDetail (description, photos, attributes)
    raw.json            the provider's raw response (for adapter tests)
    expected.json       hand-labelled facts, risk flags, product key, valuation state
    photos/             first photo (optional, for recognition and fingerprint tests)
  scans/<id>/
    photo.jpg, barcode.txt, expected.json
  series/<productKey>.json   synthetic or real price series for Price Book tests
```

`expected.json` fields: `facts` (the `GpuPcFacts` the human agrees with), `productKey`, `components` for bundles, `riskFlags`, `valuationState` (`valued` | `ask_based` | `unvalued`), `handValueMinor` (optional), `gateExpected` (`in` | `out`).

## Initial set to collect (first week of the skeleton)

- 50 Facebook listings from the founder's cell: 20 standalone GPUs, 20 PCs (at least 10 whose GPU appears only in the description), 5 wanted or empty-box posts, 5 unrelated items that pass the title gate.
- 30 eBay listings for the top 10 GPU product keys, with `itemCreationDate`.
- 20 scan photos: 10 barcoded items, 10 items with no barcode.
- 10 CeX box records for product keys with and without stock.

## Labelling guide

- Label only what the text or photo supports; use `null` for anything not stated.
- Product keys must exist in the pack dictionary; add the alias to the pack if the listing uses a new spelling.
- `handValueMinor` is your own honest estimate; the valuation test tolerance is ±20% for `valued`, no check for `ask_based` or `unvalued`.
- Record why a risk flag applies in a `notes` field so future readers understand the case.

## Runner

`pnpm test:fixtures` runs every stage against the set and prints: gate precision, extraction field accuracy, hidden-GPU detection rate, risk rule precision and recall, valuation agreement within tolerance, and identification accuracy for scans. The Review Console exports approved corrections into this folder.

Built in task 0.6: each module registers its stages by file name (`<package>/test/fixtures/<stage>[.<suite>].fixtures.ts`) and records its previous pass rates in its own `test/fixtures/pass-rates.json`; the runner prints the pass rate per module and stage, per stage and per module, and fails when one falls below the recorded run. The stage-specific measures above are what each module's suite counts as its cases. Details in `fixtures/README.md`.
