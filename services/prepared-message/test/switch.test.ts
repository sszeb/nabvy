import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { build } from '../src'
import { ALL_ON, createTestDatabase, listingIdOf, type TestDatabase } from './support/database'

// Rule 11: off (the default) and shadow show users nothing, so `build` returns null; with
// listing-assessment off its views are empty, so there is nothing to ask; quote-redaction fails
// closed: not on, no quote, while the asks still show.

const KEY = '28242423458759790'
const id = listingIdOf(KEY)
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.seed([
    {
      key: KEY,
      form: 'system',
      container: true,
      containerReason: 'parts',
      gpuState: 'not_stated',
      confirmed: ['cpu:description:i5-12400f call 07700 900123'],
      unknowns: ['gpu'],
      assessedAt: '2026-09-25T02:00:00Z',
    },
  ])
})
afterEach(async () => {
  await t.close()
})

describe('switch states', () => {
  it('off by default: no message', async () => {
    await t.switches({ 'listing-assessment': 'on', 'quote-redaction': 'on' })
    expect(await build(t.db, id)).toBeNull()
  })

  it('shadow: no message (users see nothing in shadow)', async () => {
    await t.switches({ ...ALL_ON, 'prepared-message': 'shadow' })
    expect(await build(t.db, id)).toBeNull()
  })

  it('on: the message', async () => {
    await t.switches(ALL_ON)
    const message = await build(t.db, id)
    expect(message?.checklist.map((i) => i.kind)).toEqual(['ask', 'check'])
    expect(message?.quotesShown).toBe(true)
  })

  it('listing-assessment off: its views are empty, so no message', async () => {
    await t.switches({ ...ALL_ON, 'listing-assessment': 'off' })
    expect(await build(t.db, id)).toBeNull()
  })

  it('quote-redaction off or shadow: the asks show, no quote does', async () => {
    for (const state of ['off', 'shadow'] as const) {
      await t.switches({ ...ALL_ON, 'quote-redaction': state })
      const message = await build(t.db, id)
      expect(message?.quotesShown).toBe(false)
      expect(message?.checklist).toEqual([
        { kind: 'ask', partType: 'gpu', text: 'Which graphics card (GPU) does it have?' },
      ])
      expect(JSON.stringify(message)).not.toContain('i5-12400f')
    }
  })
})
