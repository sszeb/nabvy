import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { publishWeek, runWeekly } from '../src'
import { createTestDatabase, INPUTS_ON, type TestDatabase } from './support/database'

// Rule 8 of docs/design/modules/_rules.md: a replay of the same week writes once. The key is the
// week plus the rule version (natural ID plus its version).

const WEEK = '2026-09-14'
const NOW = new Date('2026-09-25T00:00:00Z')

let t: TestDatabase
let a: string
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(INPUTS_ON)
  ;[a] = await t.centres()
  await t.wants({ centreId: a, catalogueId: 'rtx-3090', count: 12 })
  for (let i = 0; i < 10; i++) {
    await t.advert({ cityPageId: a, catalogueIds: ['rtx-3090'], listedAt: '2026-09-15T10:00:00Z' })
  }
}, 120_000)
afterAll(() => t.close())

const publish = () => t.transaction((q) => publishWeek(q, { weekStart: WEEK }, NOW))
const stored = () =>
  t.sql(
    `select centre_id, family, wants, adverts, suppressed, rule_version, published_at
     from demand_signals.cells where week_start = $1 order by centre_id, family`,
    [WEEK],
  )

describe('demand-signals idempotency', () => {
  it('writes a week once; the replay writes nothing and returns the same key', async () => {
    const first = await publish()
    expect(first.ok && first.value.written).toBe(1)
    const before = await stored()
    expect(before).toHaveLength(1)

    const second = await publish()
    expect(second.ok && second.value.written).toBe(0)
    expect(second.ok && second.value.cells).toBe(1)
    expect(await stored()).toEqual(before)
    expect(first.ok && first.value.events.map((e) => e.key)).toEqual([
      'demand-signals.published:2026-09-14@ds-1',
    ])
    expect(second.ok && second.value.events.map((e) => e.key)).toEqual(
      first.ok ? first.value.events.map((e) => e.key) : [],
    )
  })

  it('a replay after the inputs changed still writes nothing: the week stays as first published', async () => {
    const before = await stored()
    await t.wants({ centreId: a, catalogueId: 'rtx-4090', count: 15 })
    const replay = await publish()
    expect(replay.ok && replay.value.written).toBe(0)
    expect(await stored()).toEqual(before)
  })

  it('the weekly job publishes the latest closed week, once', async () => {
    const monday = new Date('2026-09-28T03:00:00Z') // the week of 2026-09-21 has closed
    const events = await runWeekly({ transaction: t.transaction }, monday)
    expect(events.map((e) => e.key)).toEqual(['demand-signals.published:2026-09-21@ds-1'])
    const again = await runWeekly({ transaction: t.transaction }, monday)
    expect(again.map((e) => e.key)).toEqual(['demand-signals.published:2026-09-21@ds-1'])
    const rows = await t.sql(
      `select count(*)::int as n from demand_signals.cells where week_start = '2026-09-21'`,
    )
    // Wants are counted as they stand when the week is published (3090: 12, 4090: 15); the 10
    // adverts were listed the week before, so this week has none.
    expect(rows[0]?.n).toBe(2)
  })

  it('the database refuses a second copy of a cell and any stored count under 10', async () => {
    await expect(
      t.sql(
        `insert into demand_signals.cells (week_start, centre_id, family, wants, adverts,
           suppressed, rule_version)
         values ($1, $2, 'rtx-3090', 12, 10, false, 'ds-1')`,
        [WEEK, a],
      ),
    ).rejects.toThrow(/cells_week_centre_family_version_key/)
    for (const [wants, adverts, suppressed] of [
      [9, null, false],
      [null, 1, false],
      [null, null, false],
      [12, null, true],
    ]) {
      await expect(
        t.sql(
          `insert into demand_signals.cells (week_start, centre_id, family, wants, adverts,
             suppressed, rule_version)
           values ('2026-09-07', $1, 'x', $2, $3, $4, 'ds-1')`,
          [a, wants, adverts, suppressed],
        ),
      ).rejects.toThrow(/cells_(wants|adverts|suppressed)_check/)
    }
  })
})
