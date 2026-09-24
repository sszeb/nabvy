# Recorded run replayed through a free `collect` job

Task 1.1c's definition of done (`docs/design/drafts/actor-integration.md`, backlog row 7):
"replaying the recorded run through a free `collect` job gives one `run-collected`".

- Run `VkryjpwS6U2GBDh3k` (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`): 21 rows,
  20 `listing` rows and 1 `sourceOutcome` row (its README). Collect job 15 re-downloaded it live
  and matched all 21 rows (`supabase/README.md`, "Lossless collection").
- Kind `search`: `run-summary.json` has one search ("gaming pc"), and a collect job's input names
  only the Apify run, so the kind comes from `RUN_SUMMARY.searches`.
- Seller objects: 3 listings carry one (the run's README, "Seller data"); the fixture's are
  same-shaped placeholders, so `v_seller_presence` still sees 3 and `v_rows` must still drop them.
- A collect job is free: nothing goes to cost-meter.
- The second watcher tick writes and publishes nothing.
