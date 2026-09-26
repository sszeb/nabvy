import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../support/database'
import { casesOf, readCase, runScenario, type Scenario } from '../support/scenario'

// Stage "privacy": what v_listing_evidence lets a reader learn (design §4.3; docs/decisions.md:15):
// people banded under 10, a reported place and band only when 3 people agree, no user ID.

const NOW = new Date('2026-09-25T12:00:00.000Z')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

describe('privacy', () => {
  for (const id of casesOf('privacy')) {
    it(id, async () => {
      const { alias } = await runScenario(t, id, readCase(id, 'input.json') as Scenario, NOW)
      const rows = await t.as(
        'nabvy_pipeline',
        async (q) =>
          (
            (await q.execute(
              `select listing_id::text as listing_id, family, scope, persons_band, persons_exact, place_id, distance_band
           from seller_reply_reports.v_listing_evidence order by listing_id, family, scope`,
            )) as unknown as { rows: Record<string, unknown>[] }
          ).rows,
      )
      expect(
        rows.map((r) => ({
          listing: alias.get(String(r.listing_id)),
          family: r.family,
          scope: r.scope,
          personsBand: r.persons_band,
          personsExact: r.persons_exact,
          placeId: r.place_id,
          distanceBand: r.distance_band,
        })),
      ).toEqual(readCase(id, 'expected.json').evidence)
      const columns = await t.sql(
        `select column_name from information_schema.columns where table_schema = 'seller_reply_reports' and table_name = 'v_listing_evidence'`,
      )
      expect(columns.some((c) => /user|reporter|note/.test(String(c.column_name)))).toBe(false)
    })
  }
})
