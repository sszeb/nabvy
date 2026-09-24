import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addAlias } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

// This module has no event handlers (../src/handlers/index.ts), so there is no batch to replay.
// Its two repeatable writes are the pack seed migration (applied once by the runner, never
// replayed by this module) and the admin-edit functions, which upsert on the same natural key
// (rule 8 of docs/design/modules/_rules.md): a repeat call must write nothing new.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)
afterAll(() => db.close())

describe('the pack seed', () => {
  it('re-running its migration a second time adds no rows', async () => {
    const seedFile = new URL(
      '../../../packages/db/migrations/product-catalogue/20260924151942_product_catalogue_seed.sql',
      import.meta.url,
    )
    const before = await db.sql(
      `select
         (select count(*)::int from product_catalogue.items) as items,
         (select count(*)::int from product_catalogue.aliases) as aliases,
         (select count(*)::int from product_catalogue.negative_contexts) as negative_contexts`,
    )
    await db.pg.exec(readFileSync(seedFile, 'utf8').replaceAll('--> statement-breakpoint', ''))
    const after = await db.sql(
      `select
         (select count(*)::int from product_catalogue.items) as items,
         (select count(*)::int from product_catalogue.aliases) as aliases,
         (select count(*)::int from product_catalogue.negative_contexts) as negative_contexts`,
    )
    expect(after).toEqual(before)
  })
})

describe('addAlias', () => {
  it('a repeat of the same catalogue ID and alias text writes nothing new', async () => {
    const input = {
      actorUserId: '00000000-0000-4000-8000-0000000000a1',
      catalogueId: 'gpu:nvidia:rtx-5080:16gb' as const,
      alias: 'a very specific listing phrase',
      source: 'admin',
    }
    const first = await db.as('nabvy_pipeline', (tx) => addAlias(tx, input))
    const second = await db.as('nabvy_pipeline', (tx) => addAlias(tx, input))
    expect([first.changed, second.changed]).toEqual([true, false])

    const rows = await db.sql(
      `select count(*)::int as n from product_catalogue.aliases where catalogue_id = $1 and alias = $2`,
      [input.catalogueId, input.alias],
    )
    expect(rows[0]?.n).toBe(1)
    const audits = await db.sql(
      `select count(*)::int as n from audit_log.entries where action = 'product-catalogue.alias-added'`,
    )
    expect(audits[0]?.n).toBe(1)
  })
})
