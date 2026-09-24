# named-before-ingest

A request names row 0 before any run has collected it. Only its hash is recorded,
and `add` reports it in `withoutLookalike` (seller-rights may call `add` again later for the
look-alikes). When the run is then collected, row 0 is hidden by its hash.
