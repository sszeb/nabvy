import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { erase, merge } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  listingRows,
  loadRun,
  RECORDED,
  relist,
  type TestDatabase,
  upstream,
} from './support/database'

const recorded = loadRun(RECORDED)
const rows = listingRows(recorded)
const original = rows.find((row) => row.listingId === '1816901372840238') as Record<string, unknown>

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const members = async () =>
  Number((await t.sql('select count(*)::int as n from relist_merge.members'))[0]?.n)
const visible = async () =>
  Number((await t.asPipeline('select count(*)::int as n from relist_merge.v_groups'))[0]?.n)

async function pair() {
  const all = await upstream(t, recorded, rows)
  const [relisted] = await upstream(t, recorded, [relist(original, '9100000000000001', 3)])
  return { all, relisted: relisted as string }
}

describe('switch', () => {
  it('off: acknowledges, writes nothing, and the view is empty', async () => {
    const { relisted } = await pair()
    await merge(t.db, { listingIds: [relisted] })
    await t.switches({ 'relist-merge': 'off' })
    const [again] = await upstream(t, recorded, [relist(original, '9100000000000002', 4)])
    const result = await merge(t.db, { listingIds: [again as string] })
    expect(result.ok && result.value).toMatchObject({ open: false, events: [] })
    expect(await members()).toBe(2)
    expect(await visible()).toBe(0)
  })

  it('a paused pipeline writes nothing', async () => {
    const { relisted } = await pair()
    await t.switches({ pipeline: 'off' })
    const result = await merge(t.db, { listingIds: [relisted] })
    expect(result.ok && result.value.open).toBe(false)
    expect(await members()).toBe(0)
  })

  it('shadow runs, writes and shows internal rows (there is no user-facing output)', async () => {
    const { relisted } = await pair()
    await t.switches({ 'relist-merge': 'shadow' })
    const result = await merge(t.db, { listingIds: [relisted] })
    expect(result.ok && result.value.events).toHaveLength(1)
    expect(await visible()).toBe(2)
  })

  it('with detail-evidence off its views are empty, so nothing merges', async () => {
    const { relisted } = await pair()
    await t.switches({ 'detail-evidence': 'off' })
    const result = await merge(t.db, { listingIds: [relisted] })
    expect(result.ok && result.value).toMatchObject({ open: true, membersWritten: 0 })
  })

  it('erase dissolves the group of an erased listing, whatever the switch says', async () => {
    const { relisted } = await pair()
    await merge(t.db, { listingIds: [relisted] })
    await t.switches({ 'relist-merge': 'off' })
    expect(await erase(t.db, [relisted, relisted])).toBe(1)
    expect(await members()).toBe(0)
    expect(await erase(t.db, [relisted])).toBe(0)
  })

  it('upstream modules carry on with this module off', async () => {
    await t.switches({ 'relist-merge': 'off' })
    expect(await upstream(t, recorded, rows)).toHaveLength(20)
  })
})
