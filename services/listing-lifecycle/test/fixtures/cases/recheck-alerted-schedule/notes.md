# recheck-alerted-schedule (synthetic)

An alerted listing is rechecked at +6 h, +24 h and +72 h (`docs/modules.md:31`, starting values).
A second request while the schedule is pending writes nothing; an ID listing-ingest never stored
is counted as unknown. Nothing is due at +5 h. details-queue keeps one item per listing, refreshed
at each step.
