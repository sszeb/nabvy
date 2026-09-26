import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ListingPoint, matchListings, results, search } from '../src'
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

// Rule 11. Off: nothing is read or written, no spec search, and both views are empty. Shadow:
// rows are written and the internal view shows them; the user-facing view shows none. On: the
// owner sees their own results, quotes redacted, never a suppressed listing, and nothing while
// listing-suppression is off. An upstream module that is off reads as unknown, never "no".

const run = loadRun(RECORDED)
const RTX_5070_BY_TITLE = '1397200465308431' // "PC Gaming RTX 5070, Ryzen 7700x 32GB DDR5 …"
const pointsFor = async (_q: unknown, ids: string[]) =>
  new Map<string, ListingPoint>(ids.map((id) => [id, { point: CHICHESTER, basis: 'field' }]))
const active = { isActive: async () => true, pointsFor }

let t: TestDatabase
let listingIds: string[]
let owner: { wantId: string; userId: string }
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  listingIds = await assessed(t, run)
  owner = await seedWant(t, { criteria: [part('gpu', null, 'RTX 5070')] })
})
afterEach(async () => {
  await t.close()
})

const count = async () =>
  Number((await t.sql('select count(*)::int as n from spec_match.matches'))[0]?.n)
const internal = () => t.asPipeline('select listing_id from spec_match.v_matches')
const app = (userId = owner.userId) =>
  t.asUser(userId, 'select listing_id, verdict, criteria from app.v_spec_match_results')
const match = () => matchListings(t.db, { listingIds, now: new Date() }, { pointsFor })

describe('switch', () => {
  it('off: acknowledges, writes nothing, both views empty, no spec search', async () => {
    await t.switches({ 'spec-match': 'off' })
    const result = await match()
    expect(result.ok && result.value.open).toBe(false)
    expect(await count()).toBe(0)
    await t.switches({ 'spec-match': 'on' })
    await match()
    await t.switches({ 'spec-match': 'off' })
    expect(await internal()).toHaveLength(0)
    expect(await app()).toHaveLength(0)
    const searched = await search(
      t.db,
      {
        userId: owner.userId,
        criteria: [part('gpu', null, 'RTX 5070')],
        point: null,
        radiusKm: null,
        currency: 'GBP',
      },
      active,
    )
    expect(searched.ok ? null : searched.error.code).toBe('spec-match.off')
  })

  it('the paused pipeline writes nothing', async () => {
    await t.switches({ pipeline: 'off' })
    await match()
    expect(await count()).toBe(0)
  })

  it('shadow: writes and shows internal rows, no user-facing row', async () => {
    await t.switches({ 'spec-match': 'shadow' })
    await match()
    expect(await internal()).toHaveLength(2)
    expect(await app()).toHaveLength(0)
  })

  it('on: the owner sees their own results with redacted quotes; another user sees none', async () => {
    await match()
    const rows = await app()
    expect(rows).toHaveLength(2)
    const quotes = rows.flatMap((r) =>
      (r.criteria as { evidence: { quote: string | null }[] }[]).flatMap((c) =>
        c.evidence.map((e) => e.quote),
      ),
    )
    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes.every((q) => typeof q === 'string')).toBe(true)
    expect(await app('00000000-0000-4000-8000-00000000beef')).toHaveLength(0)
    // quote-redaction off: the rows stay, every quote is null (fail closed).
    await t.switches({ 'quote-redaction': 'off' })
    const closed = await app()
    expect(closed).toHaveLength(2)
    expect(
      closed.every((r) =>
        (r.criteria as { evidence: { quote: string | null }[] }[]).every((c) =>
          c.evidence.every((e) => e.quote === null),
        ),
      ),
    ).toBe(true)
  })

  it('a no_match verdict is not a result', async () => {
    const capped = await seedWant(t, {
      priceCapMinor: 100,
      criteria: [part('gpu', null, 'RTX 5070')],
    })
    await match()
    expect(await internal()).toHaveLength(4)
    expect(await app(capped.userId)).toHaveLength(0)
  })

  it('a suppressed listing never shows; listing-suppression off shows nothing', async () => {
    await match()
    await t.sql(
      `insert into listing_suppression.entries (kind, value, request_id)
       select 'listing_hash', listing_suppression.listing_hash(source, source_listing_id),
              '01920000-0000-7000-8000-000000000001'
       from listing_ingest.listings where source_listing_id = $1`,
      [RTX_5070_BY_TITLE],
    )
    expect(await app()).toHaveLength(1)
    await t.sql('delete from listing_suppression.entries')
    expect(await app()).toHaveLength(2)
    await t.switches({ 'listing-suppression': 'off' })
    expect(await app()).toHaveLength(0)
  })

  it('nabvy_app reads no internal view and nothing of the table: raw quotes stay out of reach', async () => {
    await match()
    await expect(t.asUser(owner.userId, 'select * from spec_match.v_matches')).rejects.toThrow()
    await expect(
      t.asUser(owner.userId, 'select input_hash from spec_match.matches'),
    ).rejects.toThrow()
    await expect(
      t.asUser(owner.userId, `delete from spec_match.matches where user_id = '${owner.userId}'`),
    ).rejects.toThrow()
    await expect(
      t.asUser(owner.userId, 'select criteria from spec_match.matches'),
    ).rejects.toThrow()
    await expect(
      t.asUser(owner.userId, 'select listing_id from spec_match.matches'),
    ).rejects.toThrow()
    // The function behind the view returns only the caller's rows, and nothing outside withUser.
    const own = await t.asUser(owner.userId, 'select listing_id from spec_match.user_results()')
    expect(own).toHaveLength(2)
    expect(await t.asApp('select listing_id from spec_match.user_results()')).toHaveLength(0)
    await expect(t.asPipeline('select * from spec_match.user_results()')).rejects.toThrow()
  })

  it('listing-assessment off: matching carries on, and nothing is no_match on its parts', async () => {
    await t.switches({ 'listing-assessment': 'off' })
    const ram = await seedWant(t, { criteria: [sized('ram', { sizeGb: 64 })] })
    await match()
    const rows = await t.asPipeline(
      'select verdict, inside_pc from spec_match.v_matches where want_id = $1',
      [owner.wantId],
    )
    expect(rows).toHaveLength(2)
    const ramRows = await t.asPipeline(
      'select verdict from spec_match.v_matches where want_id = $1',
      [ram.wantId],
    )
    expect(ramRows.every((r) => r.verdict !== 'no_match')).toBe(true)
  })

  it('results() and search() give sections, applying the hide-noise preference with a count', async () => {
    await match()
    const mine = await t.withUser(owner.userId, (q) => results(q, { userId: owner.userId }, active))
    if (!mine.ok) throw new Error(mine.error.message)
    expect(mine.value.insidePc).toHaveLength(2)
    expect(mine.value.standalone).toHaveLength(0)
    const searched = await search(
      t.db,
      {
        userId: owner.userId,
        criteria: [part('gpu', null, 'RTX 5070')],
        point: CHICHESTER,
        radiusKm: 50,
        currency: 'GBP',
        sort: 'cheapest',
      },
      active,
    )
    if (!searched.ok) throw new Error(searched.error.message)
    const shown = searched.value.insidePc.length + searched.value.hidden.noise
    expect(shown).toBe(2)
    expect(
      searched.value.insidePc.every((r) => r.matchId === null && r.verdict !== 'no_match'),
    ).toBe(true)
    const inactive = await search(
      t.db,
      {
        userId: owner.userId,
        criteria: [part('gpu', null, 'RTX 5070')],
        point: null,
        radiusKm: null,
        currency: 'GBP',
      },
      { isActive: async () => false },
    )
    expect(inactive.ok ? null : inactive.error.code).toBe('spec-match.account_inactive')
  })
})
