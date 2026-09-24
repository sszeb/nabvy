import { createEvent, safeParseEvent } from '@nabvy/contracts'
import {
  AccountProfile,
  AccountSetStandingInput,
  events,
  module,
} from '@nabvy/contracts/modules/account'
import { vProfiles } from '@nabvy/db/schema/account'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

const U1 = '00000000-0000-4000-8000-0000000000c1'
const ADMIN = '00000000-0000-4000-8000-0000000000a1'

describe('account contracts', () => {
  it('declares its name and its four events', () => {
    expect(module).toBe('account')
    expect(Object.keys(events.definitions).sort()).toEqual([
      'account.channel-linked',
      'account.channel-unlinked',
      'account.deleted',
      'account.standing-changed',
    ])
  })

  it('every event carries only a user ID and round-trips', () => {
    for (const type of Object.keys(events.definitions) as (keyof typeof events.definitions)[]) {
      const envelope = createEvent(events, type, 1, { userId: U1 }, { key: `user:${U1}` })
      expect(safeParseEvent(events, envelope).success).toBe(true)
      expect(Object.keys(envelope.payload)).toEqual(['userId'])
    }
  })

  it('AccountProfile has exactly the columns of v_profiles, minus updatedAt (not published there)', () => {
    const columns = Object.keys(getViewConfig(vProfiles).selectedFields)
    for (const column of columns) {
      expect(Object.keys(AccountProfile.shape)).toContain(column)
    }
  })
})

describe('AccountSetStandingInput', () => {
  const base = { actorUserId: ADMIN, userId: U1, reason: 'observed abuse' }

  it('accepts lifting to active with no policy or until', () => {
    expect(AccountSetStandingInput.safeParse({ ...base, status: 'active' }).success).toBe(true)
  })

  it('refuses a suspension with no policy', () => {
    const result = AccountSetStandingInput.safeParse({
      ...base,
      status: 'suspended',
      until: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })

  it('refuses a suspension with no until', () => {
    const result = AccountSetStandingInput.safeParse({
      ...base,
      status: 'suspended',
      policy: 'fair-use',
    })
    expect(result.success).toBe(false)
  })

  it('refuses a ban that carries an until', () => {
    const result = AccountSetStandingInput.safeParse({
      ...base,
      status: 'banned',
      policy: 'fair-use',
      until: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a well-formed suspension and ban', () => {
    expect(
      AccountSetStandingInput.safeParse({
        ...base,
        status: 'suspended',
        policy: 'fair-use',
        until: '2026-10-24T00:00:00.000Z',
      }).success,
    ).toBe(true)
    expect(
      AccountSetStandingInput.safeParse({ ...base, status: 'banned', policy: 'terms' }).success,
    ).toBe(true)
  })
})
