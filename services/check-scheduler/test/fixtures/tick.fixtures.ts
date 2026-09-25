import { readdirSync, readFileSync } from 'node:fs'
import { SPEND_GOVERNOR_LEVELS } from '@nabvy/contracts/modules/spend-governor'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defaultLimits } from '../../src'
import { planTick } from '../../src/domain'

// Stage `tick`: which run each region gets in one tick, given search-planner's plan, this
// module's schedule, pending reruns and one-offs, spend-governor's throttle level and
// source-health's remaining ramp checks. Every case is synthetic (this module reads counts and
// terms, never listing content), marked `"synthetic": true` with the source it is built from.
// Expected: "<centre>:<reason>:<kind>:<shape>:<terms>" per run in send order, and
// "<centre>:<why>" per region left waiting.

const Term = z.string().min(1)
const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  now: z.iso.datetime(),
  level: z.enum(SPEND_GOVERNOR_LEVELS),
  remainingChecks: z.int().min(0),
  plan: z.array(
    z.strictObject({
      centreId: z.string(),
      term: Term,
      class: z.enum(['narrow', 'broad']),
      paidWantCount: z.int().min(0),
      rank: z.int().min(1),
    }),
  ),
  schedule: z.array(
    z.strictObject({
      centreId: z.string(),
      termClass: z.enum(['narrow', 'broad']),
      kind: z.enum(['newest', 'sweep']),
      lastRunAt: z.iso.datetime(),
    }),
  ),
  reruns: z.array(
    z.strictObject({
      id: z.uuid(),
      centreId: z.string(),
      kind: z.enum(['newest', 'sweep']),
      shape: z.enum(['verification', 'newest-check', 'sweep-narrow', 'sweep-broad']),
      terms: z.array(Term).min(1),
    }),
  ),
  oneOffs: z.array(
    z.strictObject({
      id: z.uuid(),
      purpose: z.enum(['verification', 'gap-fill', 'actor-test', 'fixture']),
      centreId: z.string(),
      terms: z.array(Term).min(1),
    }),
  ),
  yields: z.record(z.string(), z.int().min(0)),
})
const Expected = z.strictObject({ runs: z.array(z.string()), waiting: z.array(z.string()) })

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

describe('tick', () => {
  it.each(cases)('$id', ({ input, expected }) => {
    const now = new Date(input.now)
    const plan = planTick(
      {
        now,
        tickAt: now,
        level: input.level,
        remainingChecks: input.remainingChecks,
        plan: input.plan,
        schedule: input.schedule.map((s) => ({
          ...s,
          cadenceS: 1,
          nextDueAt: new Date(s.lastRunAt),
          lastRunAt: new Date(s.lastRunAt),
        })),
        reruns: input.reruns,
        oneOffs: input.oneOffs,
        yields: new Map(Object.entries(input.yields)),
      },
      defaultLimits,
    )
    expect({
      runs: plan.runs.map(
        (r) => `${r.centreId}:${r.reason}:${r.kind}:${r.shape}:${r.terms.join(',')}`,
      ),
      waiting: plan.waiting.map((w) => `${w.centreId}:${w.why}`),
    }).toEqual(expected)
  })
})
