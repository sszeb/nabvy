import { state } from '@nabvy/switches'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cardsFor } from '../src/repo'
import {
  createTestDatabase,
  setModuleSwitch,
  setSwitch,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md: listing-card has no handlers or tables (module card,
// "Owns: none"), so its only "off" behaviour is its user-facing view returning no rows. It also
// fails closed while listing-suppression is off (rule 11's exception), which the db test
// (packages/db/tests/listing-card.test.sql) checks in full; this file checks the same shape
// through the module's own TypeScript entry point, `cardsFor`.

const LISTING_ID = '01920000-0000-7000-8000-00000000001a'

async function seedListing(db: TestDatabase): Promise<void> {
  await db.sql(
    `insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
       currency, title, first_fetched_at, last_seen_at, town_label, availability, item_job_id, item_seq)
     values ($1, 'facebook', '2000000000000001', repeat('f', 64), 10000, 'GBP', 'A chair', now(),
       now(), 'Chichester', 'live', 1, 0)`,
    [LISTING_ID],
  )
}

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedListing(db)
  await setModuleSwitch(db, 'listing-ingest', 'on')
  await setModuleSwitch(db, 'listing-suppression', 'on')
}, 60_000)
afterAll(() => db.close())

describe('listing-card switch', () => {
  it('reads off with no seed row', async () => {
    expect(await db.as('nabvy_pipeline', (tx) => state(tx, 'listing-card'))).toBe('off')
  })

  it('off: the card view returns no rows', async () => {
    await setSwitch(db, 'off')
    expect(await db.as('nabvy_app', (tx) => cardsFor(tx, [LISTING_ID]))).toEqual([])
  })

  it('shadow: the card view still returns no rows (no user-facing output)', async () => {
    await setSwitch(db, 'shadow')
    expect(await db.as('nabvy_app', (tx) => cardsFor(tx, [LISTING_ID]))).toEqual([])
  })

  it('on: the card shows', async () => {
    await setSwitch(db, 'on')
    const cards = await db.as('nabvy_app', (tx) => cardsFor(tx, [LISTING_ID]))
    expect(cards).toHaveLength(1)
    expect(cards[0]?.listingId).toBe(LISTING_ID)
  })

  it('fails closed: listing-suppression off hides every listing, not only suppressed ones', async () => {
    await setModuleSwitch(db, 'listing-suppression', 'off')
    expect(await db.as('nabvy_app', (tx) => cardsFor(tx, [LISTING_ID]))).toEqual([])
    await setModuleSwitch(db, 'listing-suppression', 'on')
  })
})
