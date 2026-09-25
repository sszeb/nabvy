import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { emptyHealthDay, evaluateAlert, mergeHealthDay, pctDegradedOf } from '../../src/domain'

// Stage `health-day`: each case folds one or more synthetic jobs into a day's totals with
// `mergeHealthDay`, then checks `evaluateAlert` against the card's "Tests and fixtures" line
// (fixtures/README.md; docs/design/modules/_rules.md, rule 16).

const Job = z.strictObject({
  jobId: z.int(),
  routes: z.array(z.string()),
  sellerPresence: z.array(z.boolean()),
  newOperationIds: z.array(z.string()),
  breakerTripped: z.boolean(),
})
const SyntheticInput = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  jobs: z.array(Job),
})
const Expected = z.strictObject({
  totalSearches: z.int().nonnegative(),
  degradedSearches: z.int().nonnegative(),
  pctDegraded: z.number().min(0).max(1),
  alerted: z.array(z.string()),
})

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))

const cases = readdirSync(casesDir)
  .filter((id) => (read(id, 'input.json') as { jobs?: unknown }).jobs !== undefined)
  .sort()
  .map((id) => ({
    id,
    input: SyntheticInput.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

describe('health-day', () => {
  it.each(cases)('$id', ({ input, expected }) => {
    const totals = input.jobs.reduce(
      (day, job) =>
        mergeHealthDay(day, {
          jobId: job.jobId,
          searches: job.routes.map((route) => ({ route })),
          breakerTripped: job.breakerTripped,
          newOperationIds: job.newOperationIds,
          sellerPresence: job.sellerPresence,
        }),
      emptyHealthDay(),
    )
    const alerted = evaluateAlert(totals)
    expect({
      totalSearches: totals.totalSearches,
      degradedSearches: totals.degradedSearches,
      pctDegraded: pctDegradedOf(totals.totalSearches, totals.degradedSearches),
      alerted,
    }).toEqual(expected)
  })
})
