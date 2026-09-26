import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { build, buildMany } from '../src'
import { ALL_ON, createTestDatabase, listingIdOf, type TestDatabase } from './support/database'

// Rule 8: the module writes nothing and handles no events, so there is nothing to replay. What
// must hold instead: building twice gives the same message and changes no row anywhere, and a
// batch with a repeated ID builds each listing once.

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await t.seed([
    {
      key: '2537899006714740',
      form: 'system',
      container: true,
      containerReason: 'kind',
      gpuState: 'not_stated',
      confirmed: [],
      unknowns: ['cpu', 'gpu', 'ram_size', 'storage_size'],
      assessedAt: '2026-09-25T02:00:00Z',
    },
  ])
})
afterEach(async () => {
  await t.close()
})

// The row count of every table in every schema, as the migration superuser.
const snapshot = async () =>
  t.sql(
    `select table_schema, table_name,
            (xpath('/row/n/text()', query_to_xml(
              format('select count(*) as n from %I.%I', table_schema, table_name),
              false, true, '')))[1]::text::int as n
       from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('pg_catalog', 'information_schema')
      order by 1, 2`,
  )

describe('idempotency', () => {
  it('building twice gives the same message and writes nothing', async () => {
    const id = listingIdOf('2537899006714740')
    const before = await snapshot()
    const first = await build(t.db, id)
    const second = await build(t.db, id)
    expect(first).not.toBeNull()
    expect(second).toEqual(first)
    expect(await snapshot()).toEqual(before)
  })

  it('a repeated ID in a batch builds that listing once', async () => {
    const id = listingIdOf('2537899006714740')
    const built = await buildMany(t.db, { listingIds: [id, id] })
    expect([...built.keys()]).toEqual([id])
  })
})
