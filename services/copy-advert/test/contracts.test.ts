import {
  CopyAdvertBasis,
  CopyAdvertFlag,
  events,
  module,
  vClusterFactsRow,
  vLinksRow,
  vListingCopyFactsRow,
  vMembersRow,
} from '@nabvy/contracts/modules/copy-advert'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recompute } from '../src/index'
import {
  ALL_ON,
  collectedAndRecorded,
  createTestDatabase,
  duplicateListing,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v,
    ]),
  )

let t: TestDatabase
let emitted: unknown[] = []

beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  const run = loadRun(RECORDED)
  const source = run.dataset[6] as Record<string, unknown>
  const towns = ['Town Alpha', 'Town Beta', 'Town Gamma', 'Town Delta', 'Town Epsilon']
  const copies = towns.map((town, i) =>
    duplicateListing(source, {
      listingId: `900000000000${100 + i}`,
      cityPageId: `90000000000${i}`,
      location: town,
      listedAt: 1_790_000_000 + i * 86_400,
    }),
  )
  const { listingIds } = await collectedAndRecorded(t, run, copies)
  const result = await recompute(t.db, { listingIds })
  if (!result.ok) throw new Error(result.error.message)
  emitted = result.value.events
})
afterAll(() => t.close())

const parseAll = async (view: string, schema: { parse(v: unknown): unknown }) => {
  const rows = await t.asPipeline(`select * from copy_advert.${view}`)
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) schema.parse(camel(row))
  return rows
}

describe('copy-advert contracts', () => {
  it('declares its name', () => {
    expect(module).toBe('copy-advert')
    expect(events.module).toBe('copy-advert')
  })

  it('emits copy-advert.clustered and it parses', () => {
    expect(emitted.length).toBeGreaterThan(0)
    for (const e of emitted as { type: string; payload: unknown }[]) {
      expect(e.type).toBe('copy-advert.clustered')
      const parsed = events.definitions['copy-advert.clustered'][1].parse(e.payload)
      expect(parsed.listingIds.length).toBeGreaterThan(0)
    }
  })

  it('every internal view row parses', async () => {
    await parseAll('v_members', vMembersRow)
    await parseAll('v_cluster_facts', vClusterFactsRow)
    await parseAll('v_listing_copy_facts', vListingCopyFactsRow)
    await parseAll('v_links', vLinksRow)
  })

  it('every link basis is one of the documented five', async () => {
    const rows = await t.asPipeline('select basis from copy_advert.links')
    for (const row of rows) expect(() => CopyAdvertBasis.parse(row.basis)).not.toThrow()
  })

  it('a would-show flag, read as nabvy_app once the switch is on, parses as CopyAdvertFlag', async () => {
    await t.switches({ 'copy-advert': 'on' })
    const rows = await t.asApp(
      'select listing_id, towns, span_days, rule_version from copy_advert.flags',
    )
    for (const row of rows) {
      CopyAdvertFlag.parse({
        listingId: row.listing_id,
        towns: row.towns,
        spanDays: row.span_days,
        windowDays: 30,
        ruleVersion: row.rule_version,
      })
    }
  })

  it('no internal view carries a seller-like or raw-row column', async () => {
    const columns = await t.sql(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'copy_advert' and (table_name like 'v\\_%' or table_name = 'restricted_accounts')`,
    )
    expect(columns.length).toBeGreaterThan(0)
    for (const c of columns) {
      expect(String(c.column_name)).not.toMatch(
        /seller|profile_(url|link|pic)|^raw$|^raw_|_raw$|source_fields/,
      )
    }
  })
})
