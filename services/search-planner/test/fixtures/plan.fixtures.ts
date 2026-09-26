import { readdirSync, readFileSync } from 'node:fs'
import {
  SEARCH_PLANNER_CONTAINER_TERMS,
  SEARCH_PLANNER_MAX_ACTIVE_PAIRS,
} from '@nabvy/config/modules/search-planner'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { computePlan } from '../../src/domain'

// Stage `plan`: which (centre, term) pairs run, in what budget rank, which centres are active and
// which need a verification run, given want-manager's counts per centre and family, city-pages'
// centres and the admin-test pairs. Every case is synthetic (this module never reads listing
// content, only counts), marked `"synthetic": true` with the source it is built from.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  wantTerms: z.array(
    z.strictObject({
      centreId: z.string(),
      family: z.string(),
      wantCount: z.int(),
      paidWantCount: z.int(),
    }),
  ),
  adminPairs: z.array(z.strictObject({ centreId: z.string(), term: z.string() })),
  centres: z.array(
    z.strictObject({ cityPageId: z.string(), active: z.boolean(), verified: z.boolean() }),
  ),
  dropAdminTest: z.boolean(),
  maxPairs: z.int().optional(),
})
const Expected = z.strictObject({
  running: z.array(z.string()),
  plans: z.array(z.strictObject({ centreId: z.string(), active: z.boolean() })),
  verifications: z.array(z.strictObject({ centreId: z.string(), term: z.string() })),
})

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

describe('plan', () => {
  it.each(cases)('$id', ({ input, expected }) => {
    const plan = computePlan({
      wantTerms: input.wantTerms,
      adminPairs: input.adminPairs,
      centres: input.centres,
      dropAdminTest: input.dropAdminTest,
      containerTerms: SEARCH_PLANNER_CONTAINER_TERMS,
      maxPairs: input.maxPairs ?? SEARCH_PLANNER_MAX_ACTIVE_PAIRS,
    })
    // "<rank>:<centre>:<term>:<class>:<origin>" per running row, in rank order.
    const running = plan.terms
      .filter((r) => r.inBudget)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.origin.localeCompare(b.origin))
      .map((r) => `${r.rank}:${r.centreId}:${r.term}:${r.class}:${r.origin}`)
    expect({ running, plans: plan.plans, verifications: plan.verifications }).toEqual(expected)
    // No user ID can reach a plan: nothing in the output is shaped like one.
    expect(JSON.stringify(plan)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })
})
