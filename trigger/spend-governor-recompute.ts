// Scheduled task (backlog 1.2m, from PR #36's review): keeps `spend_governor.throttle` fresh so
// `v_throttle` never reads `hold-new` for staleness between real budget changes
// (services/spend-governor/README.md, "Refresh" and "Validity"; `recompute`'s own `plan()`
// rewrites an unchanged row after 15 minutes). Thin: loads the exchange rate and calls
// `recompute` directly, exactly as services/spend-governor/README.md already says the scheduled
// task would ("Inputs"). `recompute` is idempotent on its own (a second call at the same time
// writes nothing) and processes every budget in one call, so this needs no batching of its own.
//
// `recompute`'s `budget-alerted` events are not published from here: no task consumes them yet
// (services/spend-governor/README.md, "no module reads the throttle yet"), and Trigger.dev
// refuses a trigger to a task id that does not exist. Recorded in docs/questions/schedules.md for
// whoever wires the publisher (packages/transport/src/trigger.ts: "task 1.2 wires it").
import { loadEnv } from '@nabvy/config'
import { withPipeline } from '@nabvy/db'
import { recompute } from '@nabvy/spend-governor'
import { schedules } from '@trigger.dev/sdk'

export const spendGovernorRecompute = schedules.task({
  id: 'spend-governor-recompute',
  cron: '*/15 * * * *',
  run: async (payload) => {
    const { USD_GBP_RATE } = loadEnv(['exchangeRate'])
    const result = await withPipeline((db) =>
      recompute(db, { now: payload.timestamp.toISOString(), usdGbpRate: USD_GBP_RATE }),
    )
    return result.ok
      ? { written: result.value.written, alerts: result.value.events.length }
      : { error: result.error.code }
  },
})
