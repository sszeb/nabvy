import { setPreference } from '@nabvy/marketing-consent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEmailResolver, run } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

// re-engagement is the one inactivity-triggered programme (docs/marketing.md: "no alert_opened or
// scan_started for 14 days"), so it takes a different path through run() than the other six
// (occurrencesForProgramme's 'inactivity' branch, src/index.ts) and is covered separately from the
// event-triggered cases in test/fixtures/run.fixtures.ts.

const USER = '00000000-0000-4000-8000-0000000000d1'
const NOW = new Date('2026-09-24T12:00:00.000Z')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.createUser({ userId: USER })
  await t.sql(
    `insert into switches.switches (name, kind, state) values ('lifecycle-messaging', 'module', 'on')`,
  )
  await t.sql(
    `insert into switches.switches (name, kind, state) values ('marketing-consent', 'module', 'on')`,
  )
  await t.sql(
    `insert into switches.switches (name, kind, state) values ('product-events', 'module', 'on')`,
  )
  await t.as(
    'nabvy_app',
    (tx) => setPreference(tx, { userId: USER, category: 'tips', granted: true, source: 'signup' }),
    USER,
  )
})
afterEach(async () => {
  await t.close()
})

const emailResolver = () => new InMemoryEmailResolver({ [USER]: 'person@example.com' })

describe('re-engagement', () => {
  it('sends after 14 days with no alert_opened or scan_started (boundary: exactly 14 days)', async () => {
    await t.insertEvent({
      userId: USER,
      event: 'alert_opened',
      properties: {
        source: 'facebook',
        channel: 'telegram',
        dealScore: 0.5,
        freshnessSeconds: 10,
        valuationState: 'banded',
      },
      at: new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000),
    })
    const result = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: NOW, emailResolver: emailResolver() }),
    )
    expect(result.sent).toBe(1)
  })

  it('does not send at 13 days 23 hours (not yet inactive long enough)', async () => {
    await t.insertEvent({
      userId: USER,
      event: 'scan_started',
      properties: {
        method: 'barcode',
        confidence: 0.9,
        confirmed: true,
        onDemand: true,
        valuationState: 'banded',
        latencyMs: 500,
        action: 'buy',
      },
      at: new Date(NOW.getTime() - (14 * 24 - 1) * 60 * 60 * 1000),
    })
    const result = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: NOW, emailResolver: emailResolver() }),
    )
    expect(result.sent).toBe(0)
  })

  it('does not send again for the same inactivity anchor (idempotent)', async () => {
    await t.insertEvent({
      userId: USER,
      event: 'alert_opened',
      properties: {
        source: 'facebook',
        channel: 'telegram',
        dealScore: 0.5,
        freshnessSeconds: 10,
        valuationState: 'banded',
      },
      at: new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000),
    })
    const first = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: NOW, emailResolver: emailResolver() }),
    )
    const later = new Date(NOW.getTime() + 60 * 60 * 1000)
    const second = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: later, emailResolver: emailResolver() }),
    )
    expect(first.sent).toBe(1)
    expect(second.sent).toBe(0)
  })
})
