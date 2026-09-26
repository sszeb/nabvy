# insufficient-credit

A band is found (n=12, priced), but the user has 0 credits. `usage-ledger`'s `chargeUsage` refuses
whole, never partly (`usage-ledger.insufficient`), and scan-lookup maps that to
`scan-lookup.insufficient_credit` with the balance and amount required for the top-up prompt
(docs/scan-mode.md, "Guardrails"). No `lookups` row is written: nothing was actually shown or
charged, so there is nothing to record.
