import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolve } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

// rule 11 of docs/design/modules/_rules.md: off empties every internal view and resolve() finds
// nothing; this module has no user-facing views, so shadow and on read alike internally.

let db: TestDatabase
const setState = (state: 'off' | 'shadow' | 'on') =>
  db.sql(
    `insert into switches.switches (name, kind, state) values ('product-catalogue', 'module', $1)
     on conflict (name) do update set state = $1`,
    [state],
  )
const viewCounts = async () => ({
  items: Number((await db.sql('select count(*)::int as n from product_catalogue.v_items'))[0]?.n),
  aliases: Number(
    (await db.sql('select count(*)::int as n from product_catalogue.v_aliases'))[0]?.n,
  ),
  negativeContexts: Number(
    (await db.sql('select count(*)::int as n from product_catalogue.v_negative_contexts'))[0]?.n,
  ),
})

beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)
afterAll(() => db.close())

describe('off (the default: no row for this module yet)', () => {
  it('every internal view is empty and resolve() finds nothing', async () => {
    expect(await viewCounts()).toEqual({ items: 0, aliases: 0, negativeContexts: 0 })
    expect(await db.as('nabvy_pipeline', (tx) => resolve(tx, 'RTX 5080'))).toEqual([])
  })
})

describe('shadow', () => {
  it('internal views show rows (this module has no user-facing views to hide them from)', async () => {
    await setState('shadow')
    const counts = await viewCounts()
    expect(counts.items).toBeGreaterThan(0)
    expect(counts.aliases).toBeGreaterThan(0)
    expect(await db.as('nabvy_pipeline', (tx) => resolve(tx, 'RTX 5080'))).not.toEqual([])
  })
})

describe('on', () => {
  it('reads the same as shadow', async () => {
    await setState('on')
    const counts = await viewCounts()
    expect(counts.items).toBeGreaterThan(0)
    expect(await db.as('nabvy_pipeline', (tx) => resolve(tx, 'RTX 5080'))).not.toEqual([])
  })
})
