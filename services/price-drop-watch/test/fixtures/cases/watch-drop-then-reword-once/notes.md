# watch-drop-then-reword-once (synthetic)

Listing 1816901372840238 is £200 in the recorded run. A user watches it; a later sweep
re-collects it at £150 (one real drop, announced), and a third sweep re-collects it with only its
title reworded, still at £150. The reword fires `card-changed` again under a new key, and the
listing's latest `listing_ingest.v_price_changes` row is still the £200 -> £150 drop, but its
`drops` row is already written, so the insert writes nothing and nothing is announced. The drop is
announced once in total (review of PR #70, round 1).
