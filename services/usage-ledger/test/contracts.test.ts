import { createEvent, safeParseEvent } from '@nabvy/contracts'
import {
  events,
  module,
  USAGE_LEDGER_MESSAGES,
  UsageLedgerCharge,
  UsageLedgerErrorCode,
  UsageLedgerGrant,
} from '@nabvy/contracts/modules/usage-ledger'
import { describe, expect, it } from 'vitest'

const U1 = '00000000-0000-4000-8000-0000000000c1'

describe('usage-ledger contracts', () => {
  it('declares its name and one event carrying identifiers only', () => {
    expect(module).toBe('usage-ledger')
    const envelope = createEvent(
      events,
      'usage-ledger.balance-low',
      1,
      { userId: U1, entryId: U1 },
      { key: 'k' },
    )
    expect(safeParseEvent(events, envelope).success).toBe(true)
    expect(Object.keys(envelope.payload).sort()).toEqual(['entryId', 'userId'])
  })

  it('grants: whole credits, cash only on bought kinds, allowance and taste expire', () => {
    const base = { userId: U1, credits: 10, refId: 'r' }
    expect(UsageLedgerGrant.safeParse({ ...base, kind: 'topup', cashMinor: 500 }).success).toBe(
      true,
    )
    expect(UsageLedgerGrant.safeParse({ ...base, kind: 'topup', credits: 1.5 }).success).toBe(false)
    expect(UsageLedgerGrant.safeParse({ ...base, kind: 'referral', cashMinor: 500 }).success).toBe(
      false,
    )
    expect(UsageLedgerGrant.safeParse({ ...base, kind: 'allowance' }).success).toBe(false)
    expect(
      UsageLedgerGrant.safeParse({ ...base, kind: 'taste', expiresAt: '2026-09-27T00:00:00.000Z' })
        .success,
    ).toBe(true)
    expect(UsageLedgerGrant.safeParse({ ...base, kind: 'topup', credits: 0 }).success).toBe(false)
  })

  it('charges: never negative or fractional, refId required and printable', () => {
    const base = { userId: U1, action: 'scan_live', refId: 'scan:1' }
    expect(UsageLedgerCharge.parse({ ...base, credits: 0 }).costGbpMicros).toBe(0)
    expect(UsageLedgerCharge.safeParse({ ...base, credits: -1 }).success).toBe(false)
    expect(UsageLedgerCharge.safeParse({ ...base, credits: 0.5 }).success).toBe(false)
    expect(UsageLedgerCharge.safeParse({ ...base, credits: 1, refId: 'has space' }).success).toBe(
      false,
    )
    expect(UsageLedgerCharge.safeParse({ ...base, credits: 1, action: 'Scan' }).success).toBe(false)
  })

  it('every error code has a message', () => {
    for (const code of UsageLedgerErrorCode.options)
      expect(USAGE_LEDGER_MESSAGES[code]).toBeTruthy()
  })
})
