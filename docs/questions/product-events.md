# Open questions — product-events module

Same format as `docs/questions.md` (date, task, question, option taken and why), kept in its own
file per module so parallel build sessions never conflict appending to the shared one. The
coordinator folds these into `docs/questions.md` at a check-in.

- **2026-09-24, w1 product-events: monthly partition rotation.** `docs/contracts.md:185` says
  `product_events` is partitioned by month, but no `pg_cron` job exists anywhere in this repository
  yet (no precedent to follow), and `pg_cron` itself is not enabled by any core migration — adding
  it would be a core/foundation change, not something owned by one module's migration. Option
  taken: the access migration creates monthly partitions for one month back through three months
  ahead of whenever it is applied (`product_events.ensure_month_partition()`, called in a loop),
  plus a default partition that catches anything outside that window, so a write is never refused
  for lack of a partition even if rotation is never wired up. Needed from the owner or a later
  foundation task: enable `pg_cron` and schedule `product_events.ensure_month_partition(current_date
  + interval '2 months')` (or similar) monthly, so the default partition stays empty in practice
  rather than as the only backstop. Conservative because it never fails a write and adds no new
  core extension on its own initiative.
