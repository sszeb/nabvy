import {
  events,
  module,
  SpecMatchMatch,
  SpecMatchMatchedEvent,
  SpecMatchResult,
  SpecMatchSearchInput,
} from '@nabvy/contracts/modules/spec-match'
import { vMatches, vSpecMatchResults } from '@nabvy/db/schema/spec-match'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ListingPoint, matchListings } from '../src'
import {
  ALL_ON,
  assessed,
  CHICHESTER,
  createTestDatabase,
  loadRun,
  part,
  RECORDED,
  seedWant,
  type TestDatabase,
} from './support/database'

// Every published view row and the event parse with the module's contracts, the Drizzle view
// declarations match the contracts' keys, and no view carries a user ID or a seller-like column.

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  )

let t: TestDatabase
let emitted: unknown[] = []
let userId = ''
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  const listingIds = await assessed(t, loadRun(RECORDED))
  userId = (await seedWant(t, { criteria: [part('gpu', null, 'RTX 3070')] })).userId
  const pointsFor = async (_q: unknown, ids: string[]) =>
    new Map<string, ListingPoint>(ids.map((id) => [id, { point: CHICHESTER, basis: 'fallback' }]))
  const result = await matchListings(t.db, { listingIds, now: new Date() }, { pointsFor })
  if (!result.ok) throw new Error('match failed')
  emitted = result.value.events
}, 120_000)
afterAll(() => t.close())

describe('spec-match contracts', () => {
  it('declares its name and one event', () => {
    expect(module).toBe('spec-match')
    expect(events.module).toBe('spec-match')
    expect(Object.keys(events.definitions)).toEqual(['spec-match.matched'])
  })

  it('the event carries match IDs only, 1 to 500 (rule 7)', () => {
    expect(emitted).toHaveLength(1)
    for (const e of emitted as { payload: unknown }[]) {
      expect(Object.keys(SpecMatchMatchedEvent.parse(e.payload))).toEqual(['matchIds'])
    }
    expect(SpecMatchMatchedEvent.safeParse({ matchIds: [] }).success).toBe(false)
    const many = Array.from({ length: 501 }, () => '01920000-0000-7000-8000-000000000001')
    expect(SpecMatchMatchedEvent.safeParse({ matchIds: many }).success).toBe(false)
    expect(
      SpecMatchMatchedEvent.safeParse({ matchIds: [many[0]], title: 'RTX 3070' }).success,
    ).toBe(false)
  })

  it('v_matches rows parse as SpecMatchMatch', async () => {
    const rows = await t.asPipeline('select * from spec_match.v_matches')
    expect(rows).toHaveLength(2)
    for (const r of rows) SpecMatchMatch.parse(camel(r))
  })

  it('app.v_spec_match_results rows parse as SpecMatchResult', async () => {
    const rows = await t.asUser(userId, 'select * from app.v_spec_match_results')
    expect(rows).toHaveLength(2)
    for (const r of rows) SpecMatchResult.parse(camel(r))
  })

  it('the Drizzle views match the contracts, with no user or seller column', () => {
    const cols = (v: Parameters<typeof getViewConfig>[0]) =>
      Object.keys(getViewConfig(v).selectedFields).sort()
    expect(cols(vMatches)).toEqual(Object.keys(SpecMatchMatch.shape).sort())
    const resultKeys = Object.keys(SpecMatchResult.shape).sort()
    expect(cols(vSpecMatchResults)).toEqual(resultKeys)
    for (const c of [...cols(vMatches), ...cols(vSpecMatchResults)]) {
      expect(c).not.toMatch(/user|seller|profile|name/i)
    }
  })

  it('a search input is bounded, defaulted and checks its price range', () => {
    const base = {
      userId: '01920000-0000-7000-8000-000000000001',
      criteria: [part('gpu', null, 'RTX 5080')],
      point: null,
      radiusKm: null,
      currency: 'GBP',
    }
    expect(SpecMatchSearchInput.parse(base)).toMatchObject({ sort: 'newest', limit: 50 })
    expect(SpecMatchSearchInput.safeParse({ ...base, criteria: [] }).success).toBe(false)
    expect(SpecMatchSearchInput.safeParse({ ...base, limit: 101 }).success).toBe(false)
    expect(
      SpecMatchSearchInput.safeParse({ ...base, priceMinMinor: 500, priceMaxMinor: 100 }).success,
    ).toBe(false)
    expect(SpecMatchSearchInput.safeParse({ ...base, currency: 'USD' }).success).toBe(false)
  })
})
