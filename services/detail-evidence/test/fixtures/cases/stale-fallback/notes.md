# stale-fallback

Synthetic. With the actor's detail cache on, a row may carry `detailCacheStatus: "stale-fallback"`:
cached text that is "not proof the seller has not edited the item" (docs/fb-actor-reference.md,
`detailCacheStatus`; fb-scrap-engine/README.md:273-274). After the recorded run, a later run
returns `1716871313386322` from a stale cache with different text. The version is kept (every
version is kept, flagged stale), but it does not replace the fresh version: `v_current` still
shows the first one and nothing is announced.
