# before-rates-effective

`now` is 1 Jan 2026, before the seeded advisory fuel rate's `effective_from` (1 Mar 2026). No row
applies yet, so `tripCost` refuses with `travel-cost.no_rate` rather than pricing the trip at £0
or at a later rate it has not reached yet ("no invented numbers", `CLAUDE.md`).
