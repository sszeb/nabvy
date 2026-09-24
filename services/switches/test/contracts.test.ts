import { batchKey, createEvent, safeParseEvent } from '@nabvy/contracts'
import { events, module, SwitchesSwitch } from '@nabvy/contracts/modules/switches'
import { vState } from '@nabvy/db/schema/switches'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, expectTypeOf, it } from 'vitest'

// SwitchesSwitch is written in Zod because contracts cannot import packages/db (db depends on
// contracts). These checks keep it derived in effect: same keys, same nullability, as the view.
type ViewRow = typeof vState.$inferSelect

describe('switches contracts', () => {
  it('declares its name and one event', () => {
    expect(module).toBe('switches')
    expect(Object.keys(events.definitions)).toEqual(['switches.changed'])
  })

  it('SwitchesSwitch has exactly the columns of v_state', () => {
    const columns = Object.keys(getViewConfig(vState).selectedFields).sort()
    expect(Object.keys(SwitchesSwitch.def.shape ?? (SwitchesSwitch as never)).sort()).toEqual(
      columns,
    )
    expectTypeOf<keyof SwitchesSwitch>().toEqualTypeOf<keyof ViewRow>()
    expectTypeOf<SwitchesSwitch['changedBy']>().toEqualTypeOf<ViewRow['changedBy']>()
  })

  it('switches.changed carries names only and round-trips', async () => {
    const envelope = createEvent(
      events,
      'switches.changed',
      1,
      { names: ['apify'] },
      {
        key: await batchKey('switches.changed', ['apify']),
      },
    )
    expect(safeParseEvent(events, envelope).success).toBe(true)
    expect(() => createEvent(events, 'switches.changed', 1, { names: [] }, { key: 'k' })).toThrow()
  })
})
