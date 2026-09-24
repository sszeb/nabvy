// Fixture stage "dead-letter" (fixtures/README.md, "Runner"; pnpm test:fixtures). incidents
// touches no marketplace data, so its cases are synthetic envelopes, not a recorded run, built
// straight from the module's card ("Tests and fixtures": one record per envelope key; a retry
// re-emits the same envelope).
import type { EventEnvelope } from '@nabvy/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { record, retry } from '../../src/index'
import { createTestDatabase, type TestDatabase } from '../support/database'

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

interface Case {
  id: string
  envelope: EventEnvelope
}

// synthetic: true — built from the module card, not a recorded provider run.
const cases: Case[] = [
  {
    id: 'facebook-first-seen',
    envelope: {
      id: '00000000-0000-7000-8000-000000000010',
      type: 'listing-ingest.first-seen',
      v: 1,
      at: '2026-09-24T00:00:00.000Z',
      key: 'facebook:dead-letter-1:abc',
      payload: { listingIds: ['00000000-0000-7000-8000-000000000011'] },
    },
  },
  {
    id: 'ebay-batch-valued',
    envelope: {
      id: '00000000-0000-7000-8000-000000000020',
      type: 'asking-price-position.computed',
      v: 1,
      at: '2026-09-24T00:00:00.000Z',
      key: 'ebay:dead-letter-2:def',
      payload: {
        listingIds: [
          '00000000-0000-7000-8000-000000000021',
          '00000000-0000-7000-8000-000000000022',
        ],
      },
    },
  },
]

describe.each(cases)('dead-letter: $id', ({ envelope }) => {
  const input = {
    envelope,
    error: { code: 'source-adapters.timeout', message: 'the adapter timed out after 3 attempts' },
    attempts: 3,
    firstFailedAt: '2026-09-24T00:00:00.000Z',
  }

  it('records exactly one incident, however many times the failed event is replayed', async () => {
    const first = await harness.as('nabvy_pipeline', (db) => record(db, input))
    const replay = await harness.as('nabvy_pipeline', (db) => record(db, input))
    expect(replay.incident.id).toBe(first.incident.id)
  })

  it('a retry re-emits the same envelope that was recorded', async () => {
    const { incident } = await harness.as('nabvy_pipeline', (db) => record(db, input))
    const result = await harness.as('nabvy_app', (db) => retry(db, incident.id))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.envelope).toEqual(envelope)
  })
})
