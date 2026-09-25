# status-unresolved-stays (synthetic)

A details run returns `directItemUnresolved` for row 0 (the removed-ID row,
`fb-scrap-engine/docs/EVIDENCE_LEDGER.md`, "A removed ID returns a `directItemUnresolved` row";
verified on v2 only). detail-evidence announces it `unresolved`; the listing becomes `unresolved`,
never sold. Two later sweeps that miss it leave it `unresolved`, not `not-seen-recently`, and no
recheck is sent for a removed ID.

Absence alone never re-evaluates a listing in this state (the tick looks again only at live or
pending listings, or at new observations), so its stored missed-sweeps count stays 0.
