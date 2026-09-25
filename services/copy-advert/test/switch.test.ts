import { state } from '@nabvy/switches'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recompute } from '../src/index'
import {
  ALL_ON,
  collectedAndRecorded,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md: off acknowledges events and writes nothing (its views
// return no rows); shadow runs and writes, but no user-facing row is ever readable by nabvy_app
// (the flags RLS policy requires switches.state('copy-advert') = 'on'); on does the full job.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)
afterAll(() => db.close())

describe('copy-advert switch', () => {
  it('reads off with no seed row', async () => {
    expect(await state(db.db, 'copy-advert')).toBe('off')
  })

  it('off: recompute writes nothing and every internal view stays empty', async () => {
    await db.switches({ ...ALL_ON, 'copy-advert': 'off' })
    const run = loadRun(RECORDED)
    const { listingIds } = await collectedAndRecorded(db, run)
    const result = await recompute(db.db, { listingIds })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.changedListingIds).toEqual([])
    const prints = await db.asPipeline('select count(*)::int as n from copy_advert.prints')
    expect(prints[0]?.n).toBe(0)
    const members = await db.asPipeline('select count(*)::int as n from copy_advert.v_members')
    expect(members[0]?.n).toBe(0)
  })

  it('shadow: recompute writes, but nabvy_app can read no flag', async () => {
    await db.switches({ ...ALL_ON, 'copy-advert': 'shadow' })
    const run = loadRun(RECORDED)
    const { listingIds } = await collectedAndRecorded(db, run)
    const result = await recompute(db.db, { listingIds })
    expect(result.ok).toBe(true)
    const rows = await db.asApp(
      'select listing_id, towns, span_days, rule_version from copy_advert.flags',
    )
    expect(rows).toEqual([])
  })
})
