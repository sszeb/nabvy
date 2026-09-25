# status-missed-two-sweeps (synthetic)

Row 0 is missed by two later sweeps of its search and not observed for over 24 hours. It becomes
`not-seen-recently` (never sold, never gone), is announced, and a detail recheck is handed to
details-queue at sweep priority: the build pack marks a listing gone only by a recheck
(`docs/modules.md:31`).
