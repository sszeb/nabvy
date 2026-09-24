// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import {
  SWITCHES_ALWAYS_ON,
  type SwitchesAllowList,
  type SwitchesErrorCode,
  type SwitchesKind,
  SwitchesSetInput,
  SwitchesState,
} from '@nabvy/contracts/modules/switches'

/** Thrown by `set()`: the change is refused and nothing is written. */
export class SwitchesRefused extends Error {
  constructor(
    readonly code: SwitchesErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SwitchesRefused'
  }
}

/** The stored part of a switch that a change compares and the audit row records. */
export interface SwitchValue {
  kind: SwitchesKind
  state: SwitchesState
  allowList: SwitchesAllowList
}

/**
 * Validates an admin's change against the current row (undefined when the name is new) and
 * returns the value to store, or null when nothing would change. Throws `SwitchesRefused`.
 */
export function planChange(
  input: unknown,
  current: SwitchValue | undefined,
): { input: SwitchesSetInput; next: SwitchValue } | null {
  const parsed = SwitchesSetInput.safeParse(input)
  if (!parsed.success) {
    throw new SwitchesRefused(
      'switches.invalid_input',
      `switch change refused: ${parsed.error.message}`,
    )
  }
  const change = parsed.data
  if ((SWITCHES_ALWAYS_ON as readonly string[]).includes(change.name) && change.state !== 'on') {
    throw new SwitchesRefused('switches.always_on', `${change.name} cannot be switched off`)
  }
  if (current && current.kind !== change.kind) {
    throw new SwitchesRefused(
      'switches.kind_mismatch',
      `${change.name} is a ${current.kind}, not a ${change.kind}`,
    )
  }
  const next: SwitchValue = {
    kind: change.kind,
    state: change.state,
    allowList:
      change.allowList === undefined
        ? (current?.allowList ?? null)
        : change.allowList && [...new Set(change.allowList)].sort(),
  }
  if (current && sameValue(current, next)) return null
  return { input: change, next }
}

function sameValue(a: SwitchValue, b: SwitchValue): boolean {
  return a.state === b.state && JSON.stringify(a.allowList) === JSON.stringify(b.allowList)
}

/** Reads a state returned by the database; anything unexpected reads `off` (fail closed). */
export function readState(value: unknown): SwitchesState {
  const parsed = SwitchesState.safeParse(value)
  return parsed.success ? parsed.data : 'off'
}

/** The idempotency key of `switches.changed` for one change: the name and its change time. */
export function changedKey(name: string, changedAt: Date): string {
  return `switches.changed:${name}@${changedAt.toISOString()}`
}
