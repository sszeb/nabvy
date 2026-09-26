# Open questions: scan-lookup

- **2026-09-26, w2, scan-lookup: "asking-price position, never a value" — read literally.** The
  card says the MVP shows "Facebook asks only, as an asking-price position, never a value"
  (`docs/design/modules/scan-lookup.md`), and lists `asking-price-index` as a dependency but not
  `asking-price-position` (which does not exist under `services/`). Option taken: `lookup()`
  surfaces asking-price-index's own group figures unchanged — every qualifying group for the
  catalogue item, across context and condition, as its own band — rather than picking or ranking
  one for the scanned item, since the scanned item's own condition is unknown and guessing it
  would be an invented number (`CLAUDE.md`). Conservative because it shows real, unaltered
  comparables data and nothing this module derived on its own. Needed from the owner: whether a
  future `asking-price-position` module should instead be scan-lookup's dependency once it exists,
  narrowing the shown band to the scanned item's condition.
- **2026-09-26, w2, scan-lookup: eBay, CeX and sold-price-book have no stub to import.** Rule 1 of
  `_rules.md` describes a soft dependency as importing the absent module's
  `@nabvy/contracts/modules/<module>` stub, scaffolded by a foundation follow-up task. That task
  has not run for `ebay-adapter`, `ebay-sold`, `cex-adapter` or `sold-price-book`: none has a
  contracts file, schema or migration. Option taken: follow `scan-recognition`'s own precedent for
  its soft `cex-adapter` dependency (`cexBoxLookup`) — each source is an optional function on
  `ScanLookupProviders`, injected by the caller, absent in the MVP. Conservative because it adds
  no code that assumes those modules' shape, and a missing function reads as unknown exactly as
  the card asks. Needed from the owner or the coordinator: confirm this is an acceptable stand-in
  for the stub pattern until those modules exist, or have a foundation task scaffold their stubs
  so this module (and any other soft reader) can switch to importing them directly.
- **2026-09-26, w2, scan-lookup: the credit cost per lookup.** `pricing-console` (task 4.10b),
  which would price this, does not exist yet — the same gap `usage-ledger` records for its own
  policy-valued grants (`pendingPricingConsole`). Option taken: a starting constant,
  `SCAN_LOOKUP_CREDIT_COST` = 1, in `packages/config/src/modules/scan-lookup.ts`. Conservative
  because it is the smallest whole-credit charge and is easy to find and change once
  pricing-console exists. Needed from the owner: the actual price of a scan lookup.
- **2026-09-26, w2, scan-lookup: shadow never charges — an extension of rule 11's default.**
  Rule 11 says shadow "runs and writes" with no user-facing rows; it does not say whether a
  module that spends real money or credit should still spend while shadow. Option taken: gate
  `chargeUsage` on this module's own switch being exactly `on` (not shadow), following
  `usage-ledger`'s own decision for its switch ("a shadow charge would spend real credit while
  users see no balance"). Conservative because no user is ever charged for something they cannot
  see. Needed from the owner: whether this reasoning should become part of rule 11 itself for
  every module that spends money or credit, rather than each one deciding it separately.
