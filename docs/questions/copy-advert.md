# Open questions — copy-advert

Folded into `docs/questions.md` by the coordinator (`docs/session-conventions.md`). The design's
own open questions (wording, display threshold, legal review, targets before leaving shadow, the
control run, and the rest) are `docs/design/drafts/copy-advert.md` section 10, questions 1-12;
they are not repeated here. This file records questions that came up while building task 1.7a.

- **2026-09-24, 1.7a: `listing-suppression.changed` carries entry IDs, not listing IDs, so this
  module cannot target only the listings a change touches.** The handler
  (`services/copy-advert/src/handlers/index.ts`, `suppressionChangedHandler`) recomputes every
  currently active cluster's member instead, reading every row of `copy_advert.members` where
  `left_at is null`. Option taken: recompute everything on this event. Conservative because it
  never under-reacts to a suppression change, and correct because copy clusters are expected to be
  rare (design 4.13: "almost absent" for PC and GPU listings), so the set recomputed stays small in
  practice. Needed from the owner or a later session: whether this still holds at production scale,
  or whether `listing-suppression` should be asked to publish the listing IDs an entry resolves to.
- **2026-09-24, 1.7a: candidate detail requests (S4) have no priority below `sweep`.**
  `details-queue`'s four priorities (`new-listing`, `shortlisted`, `photo-capture`, `sweep`) do not
  include one for copy-advert's collision candidates, which the design calls "after sweep
  follow-ups (lowest)" (`docs/design/drafts/copy-advert.md` 4.12). Option taken: use `sweep`, the
  lowest available. Conservative because it never outranks a real acquisition need; it just cannot
  rank below sweep follow-ups as the design intends. Needed: either accept `sweep` or add a fifth
  priority to `details-queue`.
- **2026-09-24, 1.7a: the load test (100,000 synthetic prints, per-batch lookup p95 under 500 ms)
  from `docs/design/drafts/copy-advert.md` section 8 was not run in this task.** This session's
  environment has no long-running Postgres instance to load-test against beyond the throwaway
  database `pnpm db:dry-run` tears down immediately, and generating and loading 100,000 synthetic
  rows was out of scope for one build session's time. Option taken: ship without it, recorded here
  rather than skipped silently. Needed: a follow-up task (or the reviewer, if it has the means) runs
  the load test on a longer-lived database before the module leaves shadow.
- **2026-09-24, 1.7a: `flags` gets a row for every active clustered listing, not only members of a
  mass-posted cluster.** The schema sketch's own comment reads "one per listing in a mass-posted
  cluster" (`docs/design/drafts/copy-advert.md` 5.1), but `v_listing_copy_facts` (needed by every
  internal reader in section 7, for clusters that are not mass-posted too, for example a same-town
  relist collapse) has no other backing table. Option taken: `flags` backs `v_listing_copy_facts`
  for every active member of every active cluster; `would_show` alone (mass-posted and
  `towns >= flagMinTowns`) still decides what a user could ever be shown. Conservative because it
  changes no user-facing behaviour, only which listings appear in the internal view. Needed: the
  design confirms or adjusts this reading, since it is a scaffold-figure interpretation and not the
  actual open question.
