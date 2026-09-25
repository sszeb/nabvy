# status-marked-sold-stays (synthetic)

Row 0's card carries the seller's sold flag (`availability.sold`, which feeds can include,
`fb-scrap-engine/docs/EVIDENCE_LEDGER.md`, "Feeds can include sold rows"). It becomes
`marked-sold`: the seller's own flag, announced once. Later sweeps that miss it do not turn it into
anything else. No sale price or date is derived from it.

Absence alone never re-evaluates a listing in this state (the tick looks again only at live or
pending listings, or at new observations), so its stored missed-sweeps count stays 0.
