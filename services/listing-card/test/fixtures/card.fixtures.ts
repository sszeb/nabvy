import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cardsFor } from '../../src/repo'
import {
  createTestDatabase,
  setModuleSwitch,
  setSwitch,
  type TestDatabase,
} from '../support/database'
import { cases } from './cases'

// Stage `card` (packages/fixtures/README.md): one row per case in cases.json, each seeded into a
// shared PGlite database and read back through the module's own entry point, `cardsFor`. No
// recorded Facebook run is needed here (module card, "Owns: none"): listing-card only projects
// columns listing-ingest, detail-evidence, listing-lifecycle and listing-suppression already
// compute, so a synthetic listing exercises the real view exactly as a recorded one would.

function listingId(i: number): string {
  return `01920000-ca4d-7000-8000-${String(i).padStart(12, '0')}`
}
function sourceListingId(i: number): string {
  return `9100000000${String(i).padStart(4, '0')}`
}

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setModuleSwitch(db, 'listing-ingest', 'on')
  await setModuleSwitch(db, 'detail-evidence', 'on')
  await setModuleSwitch(db, 'listing-lifecycle', 'on')
  await setModuleSwitch(db, 'listing-suppression', 'on')
  await setSwitch(db, 'on')
}, 60_000)
afterAll(() => db.close())

describe('card', () => {
  it.each(cases)('$id', async (c) => {
    const i = cases.indexOf(c)
    const id = listingId(i)
    const sourceId = sourceListingId(i)
    await db.sql(
      `insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
         currency, title, first_fetched_at, last_seen_at, town_label, availability, item_job_id, item_seq)
       values ($1, $2, $3, repeat('a', 64), $4, $5, $6, now(), now(), $7, $8, 1, 0)`,
      [
        id,
        c.listing.source,
        sourceId,
        c.listing.priceMinor,
        c.listing.currency,
        c.listing.title,
        c.listing.townLabel,
        c.listing.availability,
      ],
    )
    if (c.detail) {
      await db.sql(
        `insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
           first_seen_at, last_seen_at, item_job_id, item_seq, title, description_status, condition,
           stale_fallback)
         values ($1, $2, $3, repeat('b', 64), now(), now(), 1, 0, $4, $5, $6, $7)`,
        [
          c.listing.source,
          sourceId,
          id,
          c.listing.title,
          c.detail.descriptionStatus,
          c.detail.condition,
          c.detail.staleFallback,
        ],
      )
      await db.sql(
        `insert into detail_evidence.fetches (source, source_listing_id, listing_id, job_id, seq,
           fetched_at, detail_outcome, description_status, stale_fallback, evidence_hash)
         values ($1, $2, $3, 1, 0, now(), 'collected', $4, $5, repeat('b', 64))`,
        [c.listing.source, sourceId, id, c.detail.descriptionStatus, c.detail.staleFallback],
      )
    }
    if (c.status) {
      await db.sql(
        `insert into listing_lifecycle.status (listing_id, source, source_listing_id, status, basis,
           input_hash, changed_by)
         values ($1, $2, $3, $4, 'unresolved-fetch', repeat('1', 64), 'listing-lifecycle')`,
        [id, c.listing.source, sourceId, c.status],
      )
    }
    if (c.suppressed) {
      const rows = await db.sql('select listing_suppression.listing_hash($1, $2) as hash', [
        c.listing.source,
        sourceId,
      ])
      const hash = rows[0]?.hash as string
      await db.sql(
        `insert into listing_suppression.entries (kind, value, request_id)
         values ('listing_hash', $1, '01920000-0000-7000-8000-0000000000f1')`,
        [hash],
      )
    }

    const cards = await db.as('nabvy_app', (tx) => cardsFor(tx, [id]))
    if (c.expected === null) {
      expect(cards).toEqual([])
      return
    }
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject(c.expected)
  })
})
