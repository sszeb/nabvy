# partial-text

Synthetic, from recorded row `1380502417485603` with `descriptionStatus: partial`. The model runs
only on `full_verified` text (`CONTAINER_LISTINGS.md:167-168`): the version is sent to
details-queue for a refresh (`partial-text`, `sweep` priority, `refresh: true`) and never to the
model. The second step replays the batch: no second request (the report shows none), one queue
item.
