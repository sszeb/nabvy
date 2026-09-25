import {
  events,
  LIFECYCLE_MESSAGING_PROGRAMMES,
  LifecycleMessagingRun,
  module,
} from '@nabvy/contracts/modules/lifecycle-messaging'
import { ProductEventsName } from '@nabvy/contracts/modules/product-events'
import { vRuns } from '@nabvy/db/schema/lifecycle-messaging'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { PROGRAMMES } from '../src/domain'

describe('lifecycle-messaging contracts', () => {
  it('declares its name and publishes no events (module card "Outputs": sends only)', () => {
    expect(module).toBe('lifecycle-messaging')
    expect(events.module).toBe('lifecycle-messaging')
    expect(Object.keys(events.definitions)).toEqual([])
  })

  it('LifecycleMessagingRun has exactly the columns of v_runs', () => {
    const columns = Object.keys(getViewConfig(vRuns).selectedFields)
    expect(columns.sort()).toEqual(Object.keys(LifecycleMessagingRun.shape).sort())
  })

  it('the programme catalogue matches the contract enum exactly', () => {
    expect(PROGRAMMES.map((p) => p.id).sort()).toEqual([...LIFECYCLE_MESSAGING_PROGRAMMES].sort())
  })

  it('every trigger, exit and goal event name is a real product-events event', () => {
    for (const programme of PROGRAMMES) {
      if (programme.trigger.kind === 'event') {
        expect(ProductEventsName.safeParse(programme.trigger.event).success).toBe(true)
      } else {
        for (const event of programme.trigger.events) {
          expect(ProductEventsName.safeParse(event).success).toBe(true)
        }
      }
      for (const event of programme.exitEvents) {
        expect(ProductEventsName.safeParse(event).success).toBe(true)
      }
      expect(ProductEventsName.safeParse(programme.goalEvent).success).toBe(true)
    }
  })

  it('rejects an unknown field (thin, strict)', () => {
    const result = LifecycleMessagingRun.safeParse({
      userId: '00000000-0000-4000-8000-000000000001',
      programme: 'trial',
      step: 'day1',
      triggeredAt: '2026-09-24T00:00:00.000Z',
      at: '2026-09-24T00:00:00.000Z',
      extra: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a programme name outside the enum', () => {
    const result = LifecycleMessagingRun.safeParse({
      userId: '00000000-0000-4000-8000-000000000001',
      programme: 'abandoned-checkout',
      step: '1h',
      triggeredAt: '2026-09-24T00:00:00.000Z',
      at: '2026-09-24T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})
