import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { settle, submit } from '../../src/index'
import {
  ALL_ON,
  createTestDatabase,
  recordingPorts,
  seedDetail,
  seedListing,
  seedUser,
  setSwitches,
  type TestDatabase,
} from '../support/database'

// Stage "submit": a sequence of pastes against one shared PGlite database, then one settle tick,
// one case per folder under cases/ whose input.json has "stage": "submit". Checks the outcome of
// each paste, the rows written, and what the settle tick sent to the details queue (through a
// recording port: the fetch itself is the details queue's and the gateway's, never this
// module's). Synthetic: listing-ingest and detail-evidence rows are seeded directly, as
// listing-card's own fixtures do.

interface Input {
  listing: { sourceListingId: string; described: boolean } | null
  pastes: { userId: string; url: string }[]
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES)
  .sort()
  .filter((id) => read(new URL(`${id}/input.json`, CASES)).stage === 'submit')

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)
afterAll(() => db?.close())
beforeEach(async () => {
  await setSwitches(db, ALL_ON)
  await db.sql('delete from pasted_link_lookup.requests')
  await db.sql('delete from detail_evidence.fetches')
  await db.sql('delete from detail_evidence.evidence')
  await db.sql('delete from listing_ingest.listings')
})

describe('submit', () => {
  for (const id of cases) {
    it(id, async () => {
      const input = read(new URL(`${id}/input.json`, CASES)) as Input
      const expected = read(new URL(`${id}/expected.json`, CASES))

      if (input.listing) {
        const listingId = await seedListing(db, { sourceListingId: input.listing.sourceListingId })
        if (input.listing.described) {
          await seedDetail(db, { listingId, sourceListingId: input.listing.sourceListingId })
        }
      }
      const outcomes: string[] = []
      const created: boolean[] = []
      for (const paste of input.pastes) {
        await seedUser(db, paste.userId, `${paste.userId}@example.com`)
        const outcome = await db.as('nabvy_app', (q) => submit(q, paste), paste.userId)
        outcomes.push(outcome.ok ? outcome.value.status : outcome.error.code)
        if (outcome.ok) created.push(outcome.value.created)
      }
      const ports = recordingPorts()
      const report = await db.as('nabvy_pipeline', (q) => settle(q, { ports }))
      if (report.status !== 'settled') throw new Error('settle ran off')

      const [requests] = (await db.sql(
        'select count(*)::int as n from pasted_link_lookup.requests',
      )) as [{ n: number }]
      const [ready] = (await db.sql(
        `select count(*)::int as n from pasted_link_lookup.requests where status = 'ready'`,
      )) as [{ n: number }]
      expect({
        outcomes,
        created,
        requests: requests.n,
        ready: ready.n,
        enqueued: ports.enqueued,
      }).toEqual(expected)
    })
  }
})
