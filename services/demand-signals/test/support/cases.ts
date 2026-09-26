import { readdirSync, readFileSync } from 'node:fs'
import { publishWeek } from '../../src'
import { type AdvertSeed, createTestDatabase, INPUTS_ON, type SwitchState } from './database'

// A fixture case (test/fixtures/cases/<id>/): synthetic wants and adverts seeded into the input
// modules' tables, one publish of one week, and the cells `v_cells` then shows. Centres are named
// A and B in the files and mapped to two real centres of city-pages' seeded grid.

const CASES = new URL('../fixtures/cases/', import.meta.url)

interface CaseAdvert extends Omit<AdvertSeed, 'cityPageId'> {
  centre: 'A' | 'B'
  /** How many identical adverts to seed (default 1); each is its own listing. */
  repeat?: number
}

interface CaseInput {
  synthetic: true
  builtFrom: string
  now: string
  weekStart: string
  switches?: Record<string, SwitchState>
  wants: { centre: 'A' | 'B'; catalogueId: string; count: number }[]
  adverts: CaseAdvert[]
}

export interface CaseOutcome {
  written: number
  cells: {
    centre: string
    family: string
    wants: number | null
    adverts: number | null
    suppressed: boolean
  }[]
}

export const caseIds = () => readdirSync(CASES).sort()

const read = (id: string, file: string) =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, CASES), 'utf8'))

export async function runCase(
  id: string,
): Promise<{ observed: CaseOutcome; expected: CaseOutcome }> {
  const input = read(id, 'input.json') as CaseInput
  const t = await createTestDatabase()
  try {
    await t.switches({ ...INPUTS_ON, ...input.switches })
    const [a, b] = await t.centres()
    const centreOf = { A: a, B: b }
    const nameOf = new Map([
      [a, 'A'],
      [b, 'B'],
    ])
    for (const w of input.wants) await t.wants({ ...w, centreId: centreOf[w.centre] })
    for (const { centre, repeat = 1, ...ad } of input.adverts) {
      for (let i = 0; i < repeat; i++) await t.advert({ ...ad, cityPageId: centreOf[centre] })
    }
    const result = await t.transaction((q) =>
      publishWeek(q, { weekStart: input.weekStart }, new Date(input.now)),
    )
    if (!result.ok) throw new Error(result.error.code)
    // Read back as a fresh reader would, with the module on so v_cells shows what was written.
    await t.switches({ 'demand-signals': 'shadow' })
    const rows = await t.asPipeline(
      `select centre_id, family, wants, adverts, suppressed from demand_signals.v_cells
       where week_start = $1 order by centre_id, family`,
      [input.weekStart],
    )
    return {
      observed: {
        written: result.value.written,
        cells: rows.map((r) => ({
          centre: nameOf.get(String(r.centre_id)) ?? String(r.centre_id),
          family: String(r.family),
          wants: r.wants === null ? null : Number(r.wants),
          adverts: r.adverts === null ? null : Number(r.adverts),
          suppressed: Boolean(r.suppressed),
        })),
      },
      expected: read(id, 'expected.json') as CaseOutcome,
    }
  } finally {
    await t.close()
  }
}
