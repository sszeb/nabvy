// Scheduled task (backlog 4.3r, from PR #33's review): runs the 24-hour account-deletion purge
// sweep every 15 minutes, well inside the 24-hour window (docs/security.md, "Account deletion";
// services/account/README.md, "Deletion purge delay"). Thin: calls `purgeDueDeletions` directly,
// exactly as its own doc comment names it ("the sweep task", services/account/src/index.ts). The
// function is a batch, idempotent sweep on its own (erases every due user's rows in one call; a
// repeat call that finds nothing due writes nothing), so this needs no batching of its own.
//
// The `account.deleted` envelopes `purgeDueDeletions` returns are not published from here: no
// task consumes them yet, and Trigger.dev refuses a trigger to a task id that does not exist.
// Recorded in docs/questions/schedules.md alongside the same gap for `spend-governor.budget-alerted`
// (trigger/spend-governor-recompute.ts).
import { purgeDueDeletions } from '@nabvy/account'
import { withPipeline } from '@nabvy/db'
import { schedules } from '@trigger.dev/sdk'

export const accountPurgeSchedule = schedules.task({
  id: 'account-purge-schedule',
  cron: '*/15 * * * *',
  run: async (payload) => {
    const { events } = await withPipeline((db) => purgeDueDeletions(db, payload.timestamp))
    return { purged: events.length }
  },
})
