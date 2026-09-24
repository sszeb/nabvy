// Public API of the switches module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/switches' only, never from its internals. SQL views use the
// functions switches.state(name), switches.is_on(name) and switches.gate_allows(gate, user_id).
import { record } from '@nabvy/audit-log'
import {
  events,
  type SwitchesSetInput,
  type SwitchesState,
  SwitchesSwitch,
} from '@nabvy/contracts/modules/switches'
import type { Queryable } from '@nabvy/db'
import { emit, type Publisher } from '@nabvy/transport'
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
 * True when the gate is `on` and its allow-list is empty (open to all) or holds the user. An
 * unknown gate, a closed gate or an unreachable database is false.
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
 * writes nothing. `switches.changed` is published keyed on the name and its change time, so a
 * retry after a lost publish sends the same key and the transport drops the repeat; a rolled-back
 * change can leave a stray event, which is harmless because readers load the state by name.
 * Throws `SwitchesRefused` for bad input, an always-on switch turned off, or a kind mismatch.
 */
export async function set(
  q: Queryable,
  publisher: Publisher,
  input: SwitchesSetInput,
): Promise<{ changed: boolean }> {
  const name = (input as { name?: unknown }).name
  const current = typeof name === 'string' ? await selectForUpdate(q, name) : undefined
  const plan = planChange(input, current)
  if (!plan) {
    // Nothing to write; re-publish the last change's key so a lost publish is recovered.
    await publishChanged(publisher, input.name, (current as { changedAt: Date }).changedAt)
    return { changed: false }
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
  await publishChanged(publisher, plan.input.name, changedAt)
  return { changed: true }
}

function auditState(value: SwitchValue) {
  return { kind: value.kind, state: value.state, allowList: value.allowList }
}

function publishChanged(publisher: Publisher, name: string, changedAt: Date) {
  return emit(
    publisher,
    events,
    'switches.changed',
    { names: [name] },
    { key: changedKey(name, changedAt) },
  )
}
