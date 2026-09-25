# Open questions: demand-signals

- **2026-09-25, w2 demand-signals: who sees demand data (card, question 20).** The card: "No
  user-facing view until the owner says who sees it." Option taken: nothing user-facing. The
  module has only the internal `demand_signals.v_cells`, granted to `nabvy_pipeline`; `nabvy_app`
  has no usage on the schema. Conservative because nothing reaches a user until the owner decides.
- **2026-09-25, w2 demand-signals: what "cells under 10 suppressed" means.** A cell has two
  counts (wants, adverts). Option taken: each count under 10 is never stored (null); a cell whose
  counts are both null is `suppressed`, and a cell with one count shown keeps the other null.
  The table's checks refuse a stored count under 10, so no small count exists anywhere, not only
  in the view. Conservative because "suppress the cell when the sum is under 10" would show a
  count of 9 wants beside 5 adverts. The threshold shown anywhere: nowhere (no user-facing view).
- **2026-09-25, w2 demand-signals: the week's want count is a snapshot.** want-manager publishes
  only the current `v_want_terms_by_centre`, not a history. Option taken: the wants of a week are
  the active wants when the week is published (the job runs after the week closes), and a
  published week is never rewritten. Conservative because it invents no history; a history view in
  want-manager (not this module's file) would allow a week's average instead.
- **2026-09-25, w2 demand-signals: what a wanted or swap advert is.** The card names
  `v_assessments`; the kind lives there as parts-record's `kind`, and `wanted_or_swap` is one kind
  for both. Option taken: an advert is a listing whose latest assessment has kind
  `wanted_or_swap`, weeked by T0 (`listed_at`), else T1 (`first_fetched_at`) when Facebook gave
  no listing time; its centre is city-pages' nearest centre to its city page
  (`v_area_membership`, the same "nearest centre" want-manager uses); its families are its
  confirmed parts' catalogue items (else the catalogue ID). Wanted and swap are not told apart
  (no input does). An advert naming no catalogue part is not counted. Conservative because it
  counts only what an input states.
- **2026-09-25, w2 demand-signals: the inputs `want-manager.changed` and
  `copy-advert.clustered`.** The card lists both events. Option taken: neither is consumed; a
  week is published once, after it closes, from the views as they then stand, so a change event
  would have nothing to do. Conservative because it adds no handler that writes on a user's action.
- **2026-09-25, w2 demand-signals: the weekly scheduled task.** A Trigger.dev task lives in
  `trigger/`, whose `package.json` is shared. Option taken: the module exports `runWeekly(deps,
  now)` (publishes the latest closed week) and the task file is left for the coordinator or the
  trigger owner to add (`schedules.task`, e.g. Monday 03:07 UTC). Conservative because this
  session edits only its own files (rule 2).
- **2026-09-25, w2 demand-signals: suppressed listings.** Listings `listing-suppression` hides
  still count in an internal aggregate. Option taken: counted, since no count leaves the pipeline
  and none is under 10. To revisit when a user-facing view is approved.
