// Public API of the switches module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/switches' only, never from its internals. SQL views use the
// functions switches.state(name), switches.is_on(name) and switches.gate_allows(gate, user_id).
import { record } from '@nabvy/audit-log'
import { createEvent, type EventEnvelope } from '@nabvy/contracts'
import {
  events,
  type SwitchesSetInput,
  type SwitchesState,
  SwitchesSwitch,
} from '@nabvy/contracts/modules/switches'
import type { Queryable } from '@nabvy/db'
import { changedKey, planChange, readState, type SwitchValue } from './domain'
import { selectAll, selectForUpdate, selectGateAllows, selectState, upsertSwitch } from './repo'

export { events, module } from '@nabvy/contracts/modules/switches'
export { SwitchesRefused } from './domain'

/**
 * The state of one switch. Fails closed: an unknown name, an unexpected value or a database that
 * cannot be reached reads `off`, so the caller stops. A failed query still aborts the caller's
 * transaction; the caller's own next statement fails with it.
 */
export async function state(q: Queryable, name: string): Promise<SwitchesState> {
  try {
    return readState(await selectState(q, name))
  } catch {
    return 'off'
  }
}

/** True only while the switch is `on`; `shadow`, `off`, unknown and unreachable are false. */
export async function isOn(q: Queryable, name: string): Promise<boolean> {
  return (await state(q, name)) === 'on'
}

/**
 * True when the gate is `on` and it has no allow-list (open to all) or its list holds the user.
 * An unknown gate, a closed gate or an unreachable database is false.
 */
export async function gateAllows(q: Queryable, gate: string, userId: string): Promise<boolean> {
  try {
    return await selectGateAllows(q, gate, userId)
  } catch {
    return false
  }
}

/** Every switch, by kind then name, for the admin screen. Needs the pipeline role. */
export async function list(q: Queryable): Promise<SwitchesSwitch[]> {
  return (await selectAll(q)).map((row) => SwitchesSwitch.parse(row))
}

/**
 * Changes one switch. The caller has checked that the session is an admin's, and passes the
 * transaction (withPipeline) so the change and its audit row commit together; if the audit row
 * cannot be written, `record()` throws and the change rolls back. A change to the current value
 * writes nothing. Returns the `switches.changed` envelope; the caller publishes it only after the
 * transaction commits (`publisher.publish([event])`), so no reader sees the event before the new
 * state. The key is the name and its change time, so repeating the change after a lost publish
 * returns the same key, and the transport drops the repeat.
 * Throws `SwitchesRefused` for bad input, an always-on switch turned off, or a kind mismatch.
 */
export async function set(
  q: Queryable,
  input: SwitchesSetInput,
): Promise<{ changed: boolean; event: EventEnvelope }> {
  const name = (input as { name?: unknown }).name
  const current = typeof name === 'string' ? await selectForUpdate(q, name) : undefined
  const plan = planChange(input, current)
  if (!plan) {
    // Nothing to write: return the last change's event, so a lost publish can be recovered.
    return {
      changed: false,
      event: changedEvent(input.name, (current as { changedAt: Date }).changedAt),
    }
  }
  const changedAt = await upsertSwitch(q, plan.input.name, plan.next, plan.input.actorUserId)
  await record(q, {
    actorUserId: plan.input.actorUserId,
    action: 'switches.changed',
    target: `switch:${plan.input.name}`,
    ...(current ? { before: auditState(current) } : {}),
    after: auditState(plan.next),
    ...(plan.input.reason ? { reason: plan.input.reason } : {}),
  })
  return { changed: true, event: changedEvent(plan.input.name, changedAt) }
}

function auditState(value: SwitchValue) {
  return { kind: value.kind, state: value.state, allowList: value.allowList }
}

function changedEvent(name: string, changedAt: Date): EventEnvelope {
  return createEvent(
    events,
    'switches.changed',
    1,
    { names: [name] },
    {
      key: changedKey(name, changedAt),
    },
  ) as EventEnvelope
}
