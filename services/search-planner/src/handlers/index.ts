// Event handlers of the search-planner module: thin (parse, call, return).
import type { EventEnvelope } from '@nabvy/contracts'
import { WantManagerChangedEvent } from '@nabvy/contracts/modules/want-manager'
import type { Queryable } from '@nabvy/db'
import { replan } from '../index'

/**
 * `want-manager.changed` v1, a batch of payloads (want IDs only): recomputes the plan once for
 * the whole batch, since want-manager's counts per centre carry no want IDs. Idempotent: the plan
 * is a function of the views, so a replay computes the same plan, writes nothing and returns no
 * event. Off: acknowledges and writes nothing. Returns the `plan-changed` envelopes for the
 * caller to publish after its transaction commits.
 */
export async function onWantManagerChanged(
  q: Queryable,
  payloads: unknown[],
): Promise<{ events: EventEnvelope[] }> {
  for (const payload of payloads) WantManagerChangedEvent.parse(payload)
  const { events } = await replan(q)
  return { events }
}
