# run-failed

Synthetic: the recorded run's job marked `failed` by the gateway. A failed run is degraded (CONTAINER_LISTINGS.md:190-192) even though its summary looks healthy. listing-ingest does not ingest a failed job, and the gap check is not run.
