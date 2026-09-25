import { createEvent } from '@nabvy/contracts'
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentRuleVersion, detailEvidenceChangedHandler, run } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  type SyntheticListing,
  type TestDatabase,
} from './support/database'

// Idempotency on (listing, pass, evidence hash, rule version): a replayed batch writes nothing
// and returns the same event keys; a new version of one listing resolves that listing only; an
// older input never replaces a newer one; the card pass never replaces the detail pass.

const CHI = {
  cityPageId: '115935195086622',
  name: 'Chichester, West Sussex',
  towns: ['Chichester'],
  lat: 50.8365,
  lng: -0.7792,
}
const listing = (id: string, description: string): SyntheticListing => ({
  listingId: id,
  title: 'RTX 3090 gaming PC',
  description,
  location: 'Chichester',
  cityPageId: CHI.cityPageId,
  coordinates: { latitude: 50.84, longitude: -0.78 },
})

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await t.cityPages([CHI])
})
afterEach(async () => {
  await t.close()
})

const counts = async () => {
  const [row] = await t.sql(
    `select (select count(*)::int from pickup_location.resolutions) as resolutions,
            (select count(*)::int from pickup_location.candidates) as candidates,
            (select count(*)::int from pickup_location.mentions) as mentions,
            (select count(*)::int from pickup_location.current) as current,
            (select count(*)::int from pickup_location.handover) as handover,
            (select max(updated_at) from pickup_location.current) as touched`,
  )
  return row
}

describe('idempotency', () => {
  it('a second run of the same batch writes nothing and returns the same event keys', async () => {
    const listingIds = await detailed(t, [
      listing('7100000000000001', 'Collection from Bognor.'),
      listing('7100000000000002', 'Cash on collection.'),
    ])
    const first = await run(t.db, { pass: 'detail', listingIds })
    const after = await counts()
    const second = await run(t.db, { pass: 'detail', listingIds: [...listingIds].reverse() })
    if (!first.ok || !second.ok) throw new Error('run failed')
    expect(first.value).toMatchObject({ resolutionsWritten: 2, listings: 2 })
    expect(first.value.changed).toHaveLength(2)
    expect(second.value).toMatchObject({ resolutionsWritten: 0, listings: 2, changed: [] })
    expect(await counts()).toEqual(after)
    expect(second.value.events.map((e) => e.key)).toEqual(
      first.value.events.filter((e) => e.type === 'pickup-location.resolved').map((e) => e.key),
    )
    expect(second.value.resolved).toEqual(first.value.resolved)
    expect(first.value.ruleVersion).toBe(currentRuleVersion())
  })

  it('a new version of one listing resolves that listing only, and an older input never wins', async () => {
    const listingIds = await detailed(t, [
      listing('7100000000000001', 'Collection from Chichester.'),
      listing('7100000000000002', 'Cash on collection.'),
    ])
    await run(t.db, { pass: 'detail', listingIds })
    const changed = await detailed(t, [
      {
        ...listing('7100000000000001', 'Collection only from Leeds.'),
        collectedAt: '2026-09-25T00:00:00.000Z',
      },
    ])
    expect(changed).toHaveLength(1)
    const second = await run(t.db, { pass: 'detail', listingIds: changed })
    if (!second.ok) throw new Error('run failed')
    expect(second.value.resolutionsWritten).toBe(1)
    expect(second.value.changed).toEqual(changed)
    const [row] = await t.asPipeline(
      'select status from pickup_location.v_areas where listing_id = $1',
      [changed[0]],
    )
    expect(row?.status).toBe('conflicting')
    const [n] = await t.asPipeline(
      'select count(*)::int as n from pickup_location.resolutions where listing_id = $1',
      [changed[0]],
    )
    expect(n?.n).toBe(2)

    // The card pass runs after the detail pass: it is recorded but never replaces the current row.
    const card = await run(t.db, { pass: 'card', listingIds: changed })
    expect(card.ok && card.value.resolutionsWritten).toBe(1)
    const [still] = await t.asPipeline(
      'select status from pickup_location.v_areas where listing_id = $1',
      [changed[0]],
    )
    expect(still?.status).toBe('conflicting')
  })

  it('the handler publishes once; a redelivery publishes nothing new', async () => {
    const listingIds = await detailed(t, [listing('7100000000000003', 'Collection from Bognor.')])
    const publisher = createMemoryPublisher()
    const handler = detailEvidenceChangedHandler({ transaction: (fn) => t.db.transaction(fn) })
    const envelope = createEvent(
      detailEvidenceEvents,
      'detail-evidence.changed',
      1,
      { listingIds },
      { key: 'detail-evidence.changed:1:0' },
    )
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-25T02:00:00.000Z' }
    const deps = { publisher, deadLetters: { record: async () => ({}) } }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('pickup-location.resolved')).toHaveLength(1)
    expect(publisher.ofType('pickup-location.changed')).toHaveLength(1)
    expect(publisher.published.every((e) => Object.keys(e.payload).join() === 'listingIds')).toBe(
      true,
    )
    expect(publisher.duplicates).toHaveLength(1)
    expect(await counts()).toMatchObject({ resolutions: 1, current: 1 })
  })

  it('a batch over 500 listing IDs is refused before reading anything', async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    )
    const result = await run(t.db, { pass: 'detail', listingIds: ids })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('pickup-location.too_many_listings')
  })

  it('listings with no current version are skipped', async () => {
    const result = await run(t.db, {
      pass: 'detail',
      listingIds: ['00000000-0000-7000-8000-000000000001'],
    })
    expect(result).toMatchObject({
      ok: true,
      value: { listings: 0, resolutionsWritten: 0, events: [] },
    })
  })
})
