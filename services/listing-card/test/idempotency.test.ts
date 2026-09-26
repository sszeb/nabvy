import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cardsFor } from '../src/repo'
import {
  createTestDatabase,
  setModuleSwitch,
  setSwitch,
  type TestDatabase,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: every handler and exported write function is
// idempotent. listing-card has neither (module card, "Owns: none" / "Outputs: its view"): its one
// exported function, `cardsFor`, only reads app.v_listing_card, so running it twice on the same
// batch can only write nothing twice. This checks exactly that, rather than being a no-op file.

const LISTING_ID = '01920000-0000-7000-8000-00000000002a'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
       currency, title, first_fetched_at, last_seen_at, town_label, availability, item_job_id, item_seq)
     values ($1, 'facebook', '3000000000000001', repeat('a', 64), 12000, 'GBP', 'A lamp', now(),
       now(), 'Chichester', 'live', 1, 0)`,
    [LISTING_ID],
  )
  await setModuleSwitch(db, 'listing-ingest', 'on')
  await setModuleSwitch(db, 'listing-suppression', 'on')
  await setSwitch(db, 'on')
}, 60_000)
afterAll(() => db.close())

describe('listing-card idempotency', () => {
  it('cardsFor run twice on the same batch returns the same rows and writes nothing', async () => {
    const first = await db.as('nabvy_app', (tx) => cardsFor(tx, [LISTING_ID]))
    const second = await db.as('nabvy_app', (tx) => cardsFor(tx, [LISTING_ID]))
    expect(second).toEqual(first)
    expect(first).toHaveLength(1)
  })
})
