// Scheduled task (services/lifecycle-messaging/README.md, "Outputs"): calls run() on a timer so a
// due step is sent close to its delay, without needing a real PostHog Workflows account to hold
// the wait state (services/lifecycle-messaging/README.md, "Decisions"). Thin, following
// spend-governor-recompute.ts's precedent: no event to validate, so it calls the module's function
// directly. `run()` is idempotent on its own (a second call in the same window sends nothing new,
// rule 8) and scans every programme in one call, so this needs no batching of its own.
//
// Every real send channel is still in-memory (no PostHog Workflows or Resend account exists yet,
// this session's brief; services/lifecycle-messaging/README.md, "Decisions"), so this task's own
// runs are a no-op in practice until those clients are wired to the real APIs.
import { withPipeline } from '@nabvy/db'
import { run } from '@nabvy/lifecycle-messaging'
import { schedules } from '@trigger.dev/sdk'

export const lifecycleMessagingRun = schedules.task({
  id: 'lifecycle-messaging-run',
  cron: '*/5 * * * *',
  run: async (payload) => withPipeline((db) => run(db, { now: payload.timestamp })),
})
