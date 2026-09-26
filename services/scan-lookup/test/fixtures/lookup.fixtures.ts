import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { lookup } from '../../src'
import {
  createTestDatabase,
  seedCredits,
  seedGroup,
  seedScan,
  seedUser,
  setAllOn,
  type TestDatabase,
} from '../support/database'

// Stage `lookup`: the card's fixture ("with every other source off, a scan shows the
// asking-price position or 'not enough asks'"), the band minimum (docs/decisions.md:15) and the
// beta's UK-only, GBP-only scope (docs/decisions.md, Precedence, "Region and currency"), as
// scripted synthetic cases run on the real migrations. There is no recorded run to build scan
// mode fixtures from: each case seeds a scan-recognition scan and asking-price-index groups
// directly, then runs `lookup()` inside withPipeline (nabvy_pipeline).

const Group = z.strictObject({
  groupKey: z.string(),
  context: z.string(),
  condition: z.string(),
  country: z.string(),
  currency: z.string(),
  n: z.number().int(),
  median: z.number().int(),
  p25: z.number().int(),
  p75: z.number().int(),
})
const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  catalogueId: z.string().min(1),
  credits: z.number().int().min(0),
  groups: z.array(Group),
})
const Expected = z.union([
  z.strictObject({
    status: z.enum(['priced', 'not_enough_asks']),
    bandsCount: z.number().int().min(0),
    sources: z.array(z.string()),
    costCredits: z.number().int().min(0),
  }),
  z.strictObject({ refused: z.string() }),
])

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .map((id) => ({
    id,
    input: Input.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setAllOn(db)
}, 60_000)
afterAll(() => db.close())

describe('lookup', () => {
  it.each(cases)('$id', async ({ id, input, expected }) => {
    const userId = randomUUID()
    const scanId = randomUUID()
    // Each case gets its own catalogue ID: cases share one database (beforeAll), and
    // selectGroups() matches on catalogueId alone, so a shared ID would leak one case's groups
    // into another's lookup.
    const catalogueId = `${input.catalogueId}-${id}`
    await seedUser(db, userId)
    if (input.credits > 0) await seedCredits(db, userId, input.credits)
    await seedScan(db, scanId, userId, catalogueId)
    for (const g of input.groups) {
      await seedGroup(db, `${scanId}-${g.groupKey}`, catalogueId, g, {
        context: g.context,
        condition: g.condition,
        country: g.country,
        currency: g.currency,
      })
    }

    const result = await db.as('nabvy_pipeline', (tx) => lookup(tx, { scanId }))

    if ('refused' in expected) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe(expected.refused)
      return
    }
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe(expected.status)
    expect(result.value.bands).toHaveLength(expected.bandsCount)
    expect(result.value.sources).toEqual(expected.sources)
    expect(result.value.costCredits).toBe(expected.costCredits)
  })
})
