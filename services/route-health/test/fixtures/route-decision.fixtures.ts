import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type RouteHealthOptions, recommendDetailRoute } from '../../src/domain/route-health'

// Stage `route-decision`: each case is one call to `recommendDetailRoute`, either a synthetic
// history built from the card or the actor's tests, or a recorded run's own `RUN_SUMMARY.detailRoute`
// (fixtures/README.md). Expected: the decision `recommendDetailRoute` returns.

const RunEntry = z.looseObject({ route: z.enum(['graphql', 'page']) })
const SyntheticInput = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  history: z.array(RunEntry),
  state: z.record(z.string(), z.unknown()).nullable(),
  options: z.record(z.string(), z.unknown()).optional(),
})
const RecordedRunInput = z.strictObject({
  run: z.string().min(1),
  runId: z.string().min(1),
  source: z.string().min(1),
})
const Expected = z.strictObject({
  route: z.enum(['graphql', 'page']),
  reason: z.string(),
  successRate: z.number().min(0).max(1).nullable(),
  attempts: z.int().nonnegative(),
  newQueryIds: z.array(z.string()),
  alert: z.boolean(),
})

const casesDir = new URL('./cases/', import.meta.url)
const fixturesRoot = new URL('../../../../fixtures/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))

const cases = readdirSync(casesDir)
  .sort()
  .map((id) => {
    const rawInput = read(id, 'input.json')
    const expected = Expected.parse(read(id, 'expected.json'))
    if ('run' in (rawInput as object)) {
      const input = RecordedRunInput.parse(rawInput)
      const summary = JSON.parse(
        readFileSync(new URL(`listings/${input.run}/run-summary.json`, fixturesRoot), 'utf8'),
      ) as { detailRoute: Record<string, unknown> }
      const history = [{ ...summary.detailRoute, runId: input.runId }]
      return { id, history, state: null, options: {}, expected }
    }
    const input = SyntheticInput.parse(rawInput)
    return {
      id,
      history: input.history,
      state: input.state,
      options: input.options ?? {},
      expected,
    }
  })

describe('route-decision', () => {
  it.each(cases)('$id', ({ history, state, options, expected }) => {
    const decision = recommendDetailRoute(
      history as never,
      state as never,
      options as Partial<RouteHealthOptions>,
    )
    expect({
      route: decision.route,
      reason: decision.reason,
      successRate: decision.successRate,
      attempts: decision.attempts,
      newQueryIds: decision.newQueryIds,
      alert: decision.alert,
    }).toEqual(expected)
  })
})
