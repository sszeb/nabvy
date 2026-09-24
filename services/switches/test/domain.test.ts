import { describe, expect, it } from 'vitest'
import { changedKey, planChange, readState, type SwitchesRefused } from '../src/domain'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const U1 = '00000000-0000-4000-8000-0000000000c1'
const U2 = '00000000-0000-4000-8000-0000000000c2'
const change = (over: Record<string, unknown> = {}) => ({
  actorUserId: ADMIN,
  name: 'cost-meter',
  kind: 'module',
  state: 'on',
  ...over,
})
const refusal = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return (error as SwitchesRefused).code
  }
  return undefined
}

describe('planChange', () => {
  it('creates a new switch with no allow-list', () => {
    expect(planChange(change(), undefined)?.next).toEqual({
      kind: 'module',
      state: 'on',
      allowList: null,
    })
  })

  it('returns null when nothing would change', () => {
    expect(planChange(change(), { kind: 'module', state: 'on', allowList: null })).toBeNull()
  })

  it('lets only a module be in shadow', () => {
    expect(planChange(change({ state: 'shadow' }), undefined)?.next.state).toBe('shadow')
    expect(
      refusal(() =>
        planChange(change({ kind: 'provider', name: 'apify', state: 'shadow' }), undefined),
      ),
    ).toBe('switches.invalid_input')
  })

  it('refuses turning off an always-on switch', () => {
    for (const name of ['audit-log', 'incidents', 'switches']) {
      expect(refusal(() => planChange(change({ name, state: 'off' }), undefined))).toBe(
        'switches.always_on',
      )
      expect(refusal(() => planChange(change({ name, state: 'shadow' }), undefined))).toBe(
        'switches.always_on',
      )
    }
  })

  it('refuses a change of kind', () => {
    expect(
      refusal(() =>
        planChange(change({ kind: 'provider' }), { kind: 'module', state: 'off', allowList: null }),
      ),
    ).toBe('switches.kind_mismatch')
  })

  it('keeps a gate allow-list when omitted, sorts and de-duplicates a new one', () => {
    const gate = { kind: 'gate' as const, state: 'on' as const, allowList: [U1] }
    const input = { name: 'facebook-alerts', kind: 'gate' }
    expect(planChange(change({ ...input, state: 'off' }), gate)?.next.allowList).toEqual([U1])
    expect(planChange(change({ ...input, allowList: [U2, U1, U2] }), gate)?.next.allowList).toEqual(
      [U1, U2],
    )
    expect(planChange(change({ ...input, allowList: null }), gate)?.next.allowList).toBeNull()
    expect(planChange(change({ ...input, allowList: [U1] }), gate)).toBeNull()
    const unsorted = { ...gate, allowList: [U2, U1] }
    expect(planChange(change({ ...input, allowList: [U1, U2] }), unsorted)).toBeNull()
  })

  it('refuses an allow-list on anything but a gate, and bad input', () => {
    expect(refusal(() => planChange(change({ allowList: [U1] }), undefined))).toBe(
      'switches.invalid_input',
    )
    expect(refusal(() => planChange(change({ name: 'Bad Name' }), undefined))).toBe(
      'switches.invalid_input',
    )
    expect(
      refusal(() => planChange(change({ name: 'g', kind: 'gate', allowList: [] }), undefined)),
    ).toBe('switches.invalid_input')
    expect(refusal(() => planChange(change({ state: 'maybe' }), undefined))).toBe(
      'switches.invalid_input',
    )
  })
})

describe('readState', () => {
  it('reads anything unexpected as off', () => {
    expect(readState('on')).toBe('on')
    expect(readState('shadow')).toBe('shadow')
    expect(readState(undefined)).toBe('off')
    expect(readState(null)).toBe('off')
    expect(readState('ON')).toBe('off')
  })
})

describe('changedKey', () => {
  it('is the name and the change time', () => {
    expect(changedKey('apify', new Date('2026-09-24T14:00:00.123Z'))).toBe(
      'switches.changed:apify@2026-09-24T14:00:00.123Z',
    )
  })
})
