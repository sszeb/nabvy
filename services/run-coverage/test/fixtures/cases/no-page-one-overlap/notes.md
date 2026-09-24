# no-page-one-overlap

Synthetic: the second run's rows are the recorded rows with every listing ID changed, so page 1 shares nothing with the previous check. A missing page-1 overlap is degraded (CONTAINER_LISTINGS.md:190-191): more new listings than one page, or a bad read. One `search-degraded` event; no baseline change.
