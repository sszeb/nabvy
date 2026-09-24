import { createMemoryPublisher } from '@nabvy/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addAlias, addItem, addNegativeContext, resolve } from '../src'
import { ProductCatalogueRefused } from '../src/domain'
import { createTestDatabase, type TestDatabase } from './support/database'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)
afterAll(() => db.close())

const turnOn = () =>
  db.sql(
    `insert into switches.switches (name, kind, state) values ('product-catalogue', 'module', 'on')
     on conflict (name) do update set state = 'on'`,
  )

describe('resolve', () => {
  it('resolves nothing while the module is off', async () => {
    const matches = await db.as('nabvy_pipeline', (tx) => resolve(tx, 'RTX 5080 16GB'))
    expect(matches).toEqual([])
  })

  it('resolves the seeded gpu-pc dictionary once switched on', async () => {
    await turnOn()
    const desktop = await db.as('nabvy_pipeline', (tx) => resolve(tx, 'MSI RTX 5080 Gaming Trio'))
    expect(desktop[0]?.catalogueId).toBe('gpu:nvidia:rtx-5080:16gb')

    const mobile = await db.as('nabvy_pipeline', (tx) =>
      resolve(tx, 'Asus ROG laptop with an RTX 5080'),
    )
    expect(mobile[0]?.catalogueId).toBe('gpu:nvidia:rtx-5080:mobile')
  })

  it('the seeded OptiPlex negative context still blocks the RTX 3090', async () => {
    // Also mentions an RTX 4090 so the dictionary tier still matches something; otherwise
    // resolve() would fall through to the pg_trgm tier, which PGlite (this test's database) does
    // not support (packages/db/tests/product-catalogue.test.sql covers that tier on real Postgres).
    const matches = await db.as('nabvy_pipeline', (tx) =>
      resolve(tx, 'Dell OptiPlex 3090 tower, also selling a spare RTX 4090'),
    )
    expect(matches.some((m) => m.catalogueId === 'gpu:nvidia:rtx-3090:24gb')).toBe(false)
    expect(matches.some((m) => m.catalogueId === 'gpu:nvidia:rtx-4090:24gb')).toBe(true)
  })
})

describe('admin edits', () => {
  it('addItem writes the item and one audit row, publishing product-catalogue.updated', async () => {
    const publisher = createMemoryPublisher()
    // Not one of the pack-seeded catalogue IDs (packages/db/migrations/product-catalogue/),
    // so the first call is a genuine addition rather than a same-value no-op.
    const input = {
      actorUserId: ADMIN,
      catalogueId: 'gpu:nvidia:rtx-9800:mobile' as const,
      kind: 'gpu' as const,
      family: 'RTX 9800',
      variant: 'mobile',
      isMobile: true,
      packId: 'gpu-pc',
      name: 'RTX 9800 (Laptop)',
    }
    const first = await db.as('nabvy_pipeline', (tx) => addItem(tx, input))
    expect(first.changed).toBe(true)
    if (first.event) await publisher.publish([first.event])

    const repeat = await db.as('nabvy_pipeline', (tx) => addItem(tx, input))
    expect(repeat.changed).toBe(false)
    expect(repeat.event).toBeUndefined()

    const audits = await db.sql(`select action, target from audit_log.entries where target = $1`, [
      'item:gpu:nvidia:rtx-9800:mobile',
    ])
    expect(audits).toEqual([
      { action: 'product-catalogue.item-added', target: 'item:gpu:nvidia:rtx-9800:mobile' },
    ])
    expect(publisher.ofType('product-catalogue.updated')).toHaveLength(1)
  })

  it('addAlias refuses an unknown catalogue ID', async () => {
    await expect(
      db.as('nabvy_pipeline', (tx) =>
        addAlias(tx, {
          actorUserId: ADMIN,
          catalogueId: 'gpu:nvidia:rtx-9999:1gb',
          alias: 'made up card',
          source: 'admin',
        }),
      ),
    ).rejects.toBeInstanceOf(ProductCatalogueRefused)
  })

  it('addNegativeContext blocks a new pattern once added (blanked globally: both RTX 3080 VRAM candidates go with it)', async () => {
    // Also mentions an RTX 4090 so the dictionary tier still matches something once "OptiFake
    // 3080" is blanked; otherwise resolve() would fall through to the pg_trgm tier, which PGlite
    // (this test's database) does not support.
    const text = 'Some OptiFake 3080 listing, also selling a spare RTX 4090'
    const before = await db.as('nabvy_pipeline', (tx) => resolve(tx, text))
    expect(before.some((m) => m.family === 'RTX 3080')).toBe(true)

    await db.as('nabvy_pipeline', (tx) =>
      addNegativeContext(tx, {
        actorUserId: ADMIN,
        pattern: '\\boptifake\\s*\\d{4}\\b',
        blockedCatalogueId: 'gpu:nvidia:rtx-3080:10gb',
        source: 'admin',
      }),
    )
    const after = await db.as('nabvy_pipeline', (tx) => resolve(tx, text))
    expect(after.some((m) => m.family === 'RTX 3080')).toBe(false)
    expect(after.some((m) => m.catalogueId === 'gpu:nvidia:rtx-4090:24gb')).toBe(true)
  })
})
