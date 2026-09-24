import { AUDIT_LOG_STATE_MAX_BYTES } from '@nabvy/contracts/modules/audit-log'
import { describe, expect, it } from 'vitest'
import { AuditLogRefused, restrictedReadInput, toEntryRow } from '../src/domain'

const ACTOR = '00000000-0000-4000-8000-0000000000a1'
const ID = '01920000-0000-7000-8000-000000000001'
const base = { actorUserId: ACTOR, action: 'auth.role-changed', target: `user:${ACTOR}` }

function refusal(input: unknown): string | undefined {
  try {
    toEntryRow(input, ID)
    return undefined
  } catch (error) {
    expect(error).toBeInstanceOf(AuditLogRefused)
    return (error as AuditLogRefused).code
  }
}

describe('toEntryRow', () => {
  it('stores absent states and reason as null', () => {
    expect(toEntryRow(base, ID)).toEqual({
      ...base,
      id: ID,
      before: null,
      after: null,
      reason: null,
    })
  })

  it('keeps before and after states', () => {
    const row = toEntryRow({ ...base, before: { role: 'user' }, after: { role: 'admin' } }, ID)
    expect(row.before).toEqual({ role: 'user' })
    expect(row.after).toEqual({ role: 'admin' })
  })

  it.each([
    ['a non-uuid actor', { ...base, actorUserId: 'someone' }],
    ['an action without a module', { ...base, action: 'role-changed' }],
    ['an upper-case action', { ...base, action: 'Auth.RoleChanged' }],
    ['a target without a kind', { ...base, target: ACTOR }],
    ['a target with spaces', { ...base, target: 'user:a b' }],
    ['a blank reason', { ...base, reason: '   ' }],
    ['a reason over 1000 characters', { ...base, reason: 'x'.repeat(1001) }],
    ['an unknown field', { ...base, at: '2026-09-24T00:00:00Z' }],
    ['a restricted read without a reason', { ...base, action: 'audit-log.restricted-read' }],
  ])('refuses %s', (_, input) => {
    expect(refusal(input)).toBe('audit-log.invalid_entry')
  })

  it('accepts a state at the size cap and refuses one byte over', () => {
    // JSON of a string is the string plus two quotes.
    const at = 'x'.repeat(AUDIT_LOG_STATE_MAX_BYTES - 2)
    expect(refusal({ ...base, after: at })).toBeUndefined()
    expect(refusal({ ...base, after: `${at}x` })).toBe('audit-log.invalid_entry')
  })

  it('accepts a 1000-character reason and trims it', () => {
    expect(toEntryRow({ ...base, reason: ` ${'x'.repeat(1000)} ` }, ID).reason).toHaveLength(1000)
  })
})

describe('restrictedReadInput', () => {
  it('targets the view and carries the reason', () => {
    const input = restrictedReadInput({
      actorUserId: ACTOR,
      view: 'apify_gateway.v_restricted_rows',
      reason: 'checking a scam report',
    })
    expect(toEntryRow(input, ID)).toMatchObject({
      action: 'audit-log.restricted-read',
      target: 'view:apify_gateway.v_restricted_rows',
      reason: 'checking a scam report',
    })
  })
})
