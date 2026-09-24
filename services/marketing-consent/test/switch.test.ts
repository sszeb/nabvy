import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canMarket, getPreferences, setPreference } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

const USER = '00000000-0000-4000-8000-0000000000f1'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.createUser({ userId: USER })
  await t.as(
    'nabvy_app',
    (tx) => setPreference(tx, { userId: USER, category: 'tips', granted: true, source: 'signup' }),
    USER,
  )
})
afterEach(async () => {
  await t.close()
})

// Rule 11 of docs/design/modules/_rules.md: off acknowledges writes but fails closed on the send
// gate ("no marketing sends", module card, "When off"); writes (the preference-centre record) and
// the internal view are never gated by this module's own switch — services/marketing-consent
// README.md, "Decisions".

describe('marketing-consent off (no seed row: switches.state reads off for an unknown name)', () => {
  it('canMarket is false even with full consent', async () => {
    const result = await t.as('nabvy_pipeline', (tx) =>
      canMarket(tx, { userId: USER, email: 'person@example.com', category: 'tips' }),
    )
    expect(result).toBe(false)
  })

  it('v_consents returns no rows', async () => {
    const rows = await t.sql('select count(*)::int as n from marketing_consent.v_consents')
    expect(Number(rows[0]?.n)).toBe(0)
  })

  it('setPreference and getPreferences still work: consent is recorded regardless of the switch', async () => {
    await t.as(
      'nabvy_app',
      (tx) =>
        setPreference(tx, {
          userId: USER,
          category: 'offers',
          granted: true,
          source: 'preference-centre',
        }),
      USER,
    )
    const prefs = await t.as('nabvy_app', (tx) => getPreferences(tx, USER), USER)
    expect(prefs.preferences).toContainEqual({ category: 'offers', granted: true })
  })
})

describe('marketing-consent on', () => {
  beforeEach(async () => {
    await t.sql(
      `insert into switches.switches (name, kind, state) values ('marketing-consent', 'module', 'on')`,
    )
  })

  it('canMarket is true for a granted category on an active, unsuppressed account', async () => {
    const result = await t.as('nabvy_pipeline', (tx) =>
      canMarket(tx, { userId: USER, email: 'person@example.com', category: 'tips' }),
    )
    expect(result).toBe(true)
  })

  it('canMarket is false for a banned account, even with consent', async () => {
    await t.createUser({ userId: USER, banned: true, banExpires: null })
    const result = await t.as('nabvy_pipeline', (tx) =>
      canMarket(tx, { userId: USER, email: 'person@example.com', category: 'tips' }),
    )
    expect(result).toBe(false)
  })
})
