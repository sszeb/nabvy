# watch-created-after-drop-no-alert (synthetic)

Listing 1816901372840238 is £200 in the recorded run and is re-collected at £150 at 01:40. Only
then, at 06:00, does the user watch it. A later sweep re-collects it with a reworded title at the
same £150, which fires `card-changed`; the listing's latest `listing_ingest.v_price_changes` row
is the £200 -> £150 drop, but it was observed before the watch's `created_at`, so it is never a
candidate: nothing is written to the watch's `drops` and nothing is announced (review of PR #70,
round 1).
