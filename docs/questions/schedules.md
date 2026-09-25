# Questions: schedules

Entries in the format of `docs/questions.md`; the coordinator folds them in at a batched push. The 1.2m entries were folded on 2026-09-24 (PR #58); only the 4.3r entry below is new.

- **2026-09-24, 4.3r schedules: same two decisions, for the account purge sweep.** `docs/backlog.md`
  0.12 (added after 1.2m merged) enables `pg_cron` for partition rotation and notes it as "also the
  natural home for the schedules in 1.2m and 4.3r if those sessions choose `pg_cron` over
  Trigger.dev" — but 0.12 had not merged when this session started, so no `cron.schedule` precedent
  existed yet, and 1.2m had already picked Trigger.dev. Option taken: `account-purge-schedule.ts`
  follows the same shape as `spend-governor-recompute.ts` for consistency — `schedules.task` calling
  `purgeDueDeletions` directly every 15 minutes, added to the now-existing `@nabvy/trigger` package
  (no further workspace changes needed) — and does not publish the `account.deleted` events the
  function returns, for the same reason (no consumer task, no `TriggerClient` adapter yet).
  Follow-up, if 0.12 lands: moving either schedule to `pg_cron` is a migration plus deleting the
  task file, not a redesign.
