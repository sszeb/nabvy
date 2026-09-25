// Scheduled task: daily window expiry (docs/design/drafts/copy-advert.md 4.8). Drops members
// whose listing has not been seen within the 30-day window and recomputes the clusters they
// leave. Thin: calls `expireWindow` directly, as trigger/README.md's one scheduled-task precedent
// (spend-governor-recompute.ts) does. Publishing `copy-advert.clustered` waits on the same gap
// that task notes: no consumer task exists yet, and the TriggerClient publisher adapter
// (packages/transport/src/trigger.ts) is task 1.2's to build.

import { expireWindow } from '@nabvy/copy-advert'
import { withPipeline } from '@nabvy/db'
import { schedules } from '@trigger.dev/sdk'

export const copyAdvertExpire = schedules.task({
  id: 'copy-advert-expire',
  cron: '17 3 * * *',
  run: async (payload) => {
    const report = await withPipeline((db) => expireWindow(db, payload.timestamp))
    return { changed: report.changedListingIds.length, events: report.events.length }
  },
})
