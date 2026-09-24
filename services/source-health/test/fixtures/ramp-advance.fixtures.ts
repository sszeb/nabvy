import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { decideRampAdvance } from '../../src/domain'

// Stage `ramp-advance`: each case is one call to `decideRampAdvance`, from the card's "Tests and
// fixtures" line: "the ramp does not advance after a rise" (fixtures/README.md).

const SyntheticInput = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  current: z.strictObject({ stage: z.int().nonnegative(), startedAt: z.string() }),
  now: z.string(),
  todayPctDegraded: z.number().min(0).max(1),
  previousPctDegraded: z.number().min(0).max(1).nullable(),
  stages: z.array(
    z.strictObject({ maxChecksPerDay: z.int().positive(), minHoursAtStage: z.number().positive() }),
  ),
})
const Expected = z.strictObject({
  advance: z.boolean(),
  reason: z.enum(['too-soon', 'degraded-rate-rose', 'held-or-improved', 'max-stage']),
  nextStage: z.int().nonnegative().optional(),
})

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))

const cases = readdirSync(casesDir)
  .filter((id) => (read(id, 'input.json') as { current?: unknown }).current !== undefined)
  .sort()
  .map((id) => ({
    id,
    input: SyntheticInput.parse(read(id, 'input.json')),
    expected: Expected.parse(read(id, 'expected.json')),
  }))

describe('ramp-advance', () => {
  it.each(cases)('$id', ({ input, expected }) => {
    const decision = decideRampAdvance(
      { stage: input.current.stage, startedAt: new Date(input.current.startedAt) },
      new Date(input.now),
      input.todayPctDegraded,
      input.previousPctDegraded,
      input.stages,
    )
    expect(decision).toEqual(expected)
  })
})
