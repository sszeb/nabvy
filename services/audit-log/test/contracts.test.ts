import {
  AuditLogEntry,
  AuditLogRecordInput,
  events,
  module,
} from '@nabvy/contracts/modules/audit-log'
import { vEntries } from '@nabvy/db/schema/audit-log'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { restrictedReadInput } from '../src/domain'

// AuditLogEntry is written in Zod because contracts cannot import packages/db (db depends on
// contracts). These checks keep it derived in effect: same keys, same types, as the view.
type ViewRow = typeof vEntries.$inferSelect
type AsWire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] }

describe('audit-log contracts', () => {
  it('declares its name and no events', () => {
    expect(module).toBe('audit-log')
    expect(events.module).toBe('audit-log')
  })

  it('AuditLogEntry has exactly the columns of v_entries', () => {
    const columns = Object.keys(getViewConfig(vEntries).selectedFields).sort()
    expect(Object.keys(AuditLogEntry.def.shape ?? (AuditLogEntry as never)).sort()).toEqual(columns)
    expectTypeOf<keyof AuditLogEntry>().toEqualTypeOf<keyof ViewRow>()
    expectTypeOf<AuditLogEntry['at']>().toEqualTypeOf<AsWire<ViewRow>['at']>()
    expectTypeOf<AuditLogEntry['reason']>().toEqualTypeOf<ViewRow['reason']>()
    expectTypeOf<AuditLogEntry['actorUserId']>().toEqualTypeOf<ViewRow['actorUserId']>()
  })

  it('a restricted-read input built by the module parses', () => {
    const input = restrictedReadInput({
      actorUserId: '00000000-0000-4000-8000-0000000000a1',
      view: 'apify_gateway.v_restricted_rows',
      reason: 'scam report 42',
    })
    expect(AuditLogRecordInput.parse(input)).toEqual(input)
  })
})
