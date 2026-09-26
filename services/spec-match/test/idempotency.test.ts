import { createEvent } from '@nabvy/contracts'
import { events as wantManagerEvents } from '@nabvy/contracts/modules/want-manager'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { erase, type ListingPoint, matchListings, matchWants, onAccountDeleted } from '../src'
import { listingEventHandlers, wantManagerChangedHandler } from '../src/handlers'
import {
  ALL_ON,
  assessed,
  CHICHESTER,
  createTestDatabase,
  loadRun,
  part,
  RECORDED,
  seedWant,
  sized,
  type TestDatabase,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: a replay writes nothing and announces nothing; only
// verdict changes are announced; a want's edit backfills over the last seven days' listings.

let t: TestDatabase
let listingIds: string[] = []
const pointsFor = async (_q: unknown, ids: string[]) =>
  new Map<string, ListingPoint>(ids.map((id) => [id, { point: CHICHESTER, basis: 'field' }]))
const count = async () =>
  Number((await t.sql('select count(*)::int as n from spec_match.matches'))[0]?.n)

beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  listingIds = await assessed(t, loadRun(RECORDED))
}, 120_000)
afterAll(() => t.close())

describe('spec-match idempotency', () => {
  it('a second run of the same batch writes nothing and announces nothing', async () => {
    await seedWant(t, { criteria: [part('gpu', null, 'RTX 5070')] })
    const first = await matchListings(t.db, { listingIds, now: new Date() }, { pointsFor })
    if (!first.ok) throw new Error(first.error.message)
    expect(first.value.written).toBe(2)
    expect(first.value.changed).toHaveLength(2)
    expect(first.value.events).toHaveLength(1)
    const rows = await count()
    const again = await matchListings(
      t.db,
      { listingIds: [...listingIds].reverse(), now: new Date() },
      { pointsFor },
    )
    if (!again.ok) throw new Error(again.error.message)
    expect(again.value).toMatchObject({ written: 0, current: 2, changed: [], events: [] })
    expect(await count()).toBe(rows)
  })

  it('new inputs write new rows and announce verdict changes; old inputs reuse old rows', async () => {
    // Without points the distance criterion becomes not stated: the verdict changes (announced);
    // back with points, the old rows become the latest again (announced again).
    const without = await matchListings(t.db, { listingIds, now: new Date() })
    if (!without.ok) throw new Error(without.error.message)
    expect(without.value.written).toBe(2)
    expect(without.value.changed).toHaveLength(2)
    const back = await matchListings(t.db, { listingIds, now: new Date() }, { pointsFor })
    if (!back.ok) throw new Error(back.error.message)
    expect(back.value.written).toBe(2)
    expect(back.value.changed).toHaveLength(2)
    const latest = await t.asPipeline(
      `select m.verdict from spec_match.v_matches m
       join spec_match.matches x on x.id = m.match_id where x.backfill = false`,
    )
    expect(latest.map((r) => r.verdict)).toEqual(['match', 'match'])
  })

  it('a batch over 500 listing IDs is refused before reading anything', async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    )
    const result = await matchListings(t.db, { listingIds: ids, now: new Date() })
    expect(result.ok ? null : result.error.code).toBe('spec-match.too_many_listings')
  })

  it('a new want backfills over recent listings, marked backfill, and a replay adds nothing', async () => {
    const { wantId } = await seedWant(t, { criteria: [sized('storage', { sizeGb: 1000 })] })
    const first = await matchWants(t.db, { wantIds: [wantId], now: new Date() }, { pointsFor })
    if (!first.ok) throw new Error(first.error.message)
    expect(first.value.written).toBe(8)
    const rows = await t.sql('select backfill from spec_match.matches where want_id = $1', [wantId])
    expect(rows.every((r) => r.backfill === true)).toBe(true)
    const again = await matchWants(t.db, { wantIds: [wantId], now: new Date() }, { pointsFor })
    if (!again.ok) throw new Error(again.error.message)
    expect(again.value).toMatchObject({ written: 0, changed: [] })
  })

  it('a backfill window that holds no listing matches nothing', async () => {
    const { wantId } = await seedWant(t, { criteria: [part('gpu', null, 'RTX 3070')] })
    const later = new Date(Date.now() + 8 * 86_400_000)
    const result = await matchWants(t.db, { wantIds: [wantId], now: later }, { pointsFor })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.written).toBe(0)
  })

  it('a deleted want loses its matches; a paused one keeps them and matches nothing new', async () => {
    const { wantId } = await seedWant(t, { criteria: [part('gpu', null, 'RTX 3070')] })
    await matchWants(t.db, { wantIds: [wantId], now: new Date() }, { pointsFor })
    const stored = async () =>
      Number(
        (
          await t.sql('select count(*)::int as n from spec_match.matches where want_id = $1', [
            wantId,
          ])
        )[0]?.n,
      )
    expect(await stored()).toBe(2)
    await t.sql('update want_manager.wants set active = false where id = $1', [wantId])
    await matchWants(t.db, { wantIds: [wantId], now: new Date() }, { pointsFor })
    expect(await stored()).toBe(2)
    await t.sql('delete from want_manager.wants where id = $1', [wantId])
    await matchWants(t.db, { wantIds: [wantId], now: new Date() }, { pointsFor })
    expect(await stored()).toBe(0)
  })

  it('the handlers publish once; a redelivery adds nothing and keeps T5', async () => {
    const { wantId } = await seedWant(t, { criteria: [part('gpu', null, 'RTX 2070 Super')] })
    const publisher = createMemoryPublisher()
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-25T02:00:00.000Z' }
    const transaction = <T>(fn: (q: typeof t.db) => Promise<T>) => t.db.transaction(fn)
    const handler = wantManagerChangedHandler({ transaction, pointsFor })
    const event = createEvent(
      wantManagerEvents,
      'want-manager.changed',
      1,
      { wantIds: [wantId] },
      { key: `want-manager.changed:${wantId}@0` },
    )
    const at = (iso: string) => ({
      publisher,
      deadLetters: { record: async () => ({}) },
      now: () => new Date(iso),
    })
    // The backfill window is measured from the hop time, so the hop is now.
    const now = new Date()
    const later = new Date(now.getTime() + 3_600_000)
    expect((await handler.run(event, attempt, at(now.toISOString()))).status).toBe('handled')
    const redelivered = await handler.run(event, attempt, at(later.toISOString()))
    expect(redelivered).toMatchObject({ status: 'handled', emitted: 0 })
    expect(publisher.ofType('spec-match.matched')).toHaveLength(1)
    expect(publisher.duplicates).toHaveLength(0)
    expect(publisher.published[0]?.payload).toEqual({ matchIds: [expect.any(String)] })
    const [row] = await t.sql('select matched_at from spec_match.matches where want_id = $1', [
      wantId,
    ])
    expect(new Date(row?.matched_at as string).toISOString()).toBe(now.toISOString())
    expect(listingEventHandlers({ transaction })).toHaveLength(3)
  })

  it('erase and the account purge remove every match of the listings or the user', async () => {
    const { wantId, userId } = await seedWant(t, { criteria: [part('gpu', null, 'GTX 1660')] })
    await matchWants(t.db, { wantIds: [wantId], now: new Date() }, { pointsFor })
    expect(await onAccountDeleted(t.db, [{ userId }])).toBe(1)
    const before = await count()
    expect(before).toBeGreaterThan(0)
    expect(await erase(t.db, listingIds)).toBe(before)
    expect(await count()).toBe(0)
  })
})
