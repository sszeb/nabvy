import { readdirSync, readFileSync } from 'node:fs'
import type { WantManagerUpsertWantInput } from '@nabvy/contracts/modules/want-manager'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteWant, setActive, upsertWant } from '../../src/index'
import {
  ALL_ON,
  CHICHESTER,
  createTestDatabase,
  REDHILL,
  seedCatalogueItem,
  seedCentre,
  seedEntitlement,
  seedFairUse,
  seedUser,
  setSwitches,
  type TestDatabase,
  testDeps,
  wantInput,
} from '../support/database'

// Stage "wants": a sequence of upsertWant/setActive/deleteWant calls for one user, synthetic (no
// recorded Facebook run needed: this module never reads listing content, only the user's own
// wants). Each case states the outcome codes of every step, the stored wants and centres, and
// the rows the four internal views show, so a change to postcode resolution, the cap or a view
// shows up as a failed case. Every case's input.json is marked "synthetic": true and its notes.md
// names the rule it is built from.

interface Step {
  kind: 'upsert' | 'active' | 'delete'
  /** upsert: overrides of the standard want input; `wantId` may be a step index ("#0"). */
  input?: Partial<WantManagerUpsertWantInput> & { wantId?: string }
  /** active/delete: the index of the step whose want to act on, and the new state. */
  ref?: string
  active?: boolean
}

interface Input {
  synthetic: true
  userId: string
  switches?: Record<string, 'off' | 'shadow' | 'on'>
  entitlement?: { status: 'free' | 'trialing' | 'active' | 'past_due'; wants: number }
  fairUseMaxActiveHunts?: number
  steps: Step[]
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await seedCentre(t, CHICHESTER)
  await seedCentre(t, { ...REDHILL, verified: true })
  await seedCatalogueItem(t, {
    catalogueId: 'gpu:rtx-4080',
    kind: 'gpu',
    family: 'RTX 40',
    name: 'RTX 4080',
  })
})
afterEach(async () => {
  await t.close()
})

const rows = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows

describe('wants', () => {
  for (const id of cases) {
    it(id, async () => {
      const input = read(new URL(`${id}/input.json`, CASES)) as Input
      const expected = read(new URL(`${id}/expected.json`, CASES))
      const u = input.userId
      await seedUser(t, u, `${id}@example.com`)
      await setSwitches(t, { ...ALL_ON, ...input.switches })
      if (input.entitlement) await seedEntitlement(t, { userId: u, ...input.entitlement })
      if (input.fairUseMaxActiveHunts !== undefined)
        await seedFairUse(t, u, input.fairUseMaxActiveHunts)

      const ids: (string | null)[] = []
      const resolve = (ref: string | undefined) =>
        ref?.startsWith('#') ? (ids[Number(ref.slice(1))] ?? '') : ref
      const outcomes: string[] = []
      for (const step of input.steps) {
        if (step.kind === 'upsert') {
          const { wantId, ...rest } = step.input ?? {}
          const resolved = resolve(wantId)
          const outcome = await t.as(
            'nabvy_app',
            (q) =>
              upsertWant(
                q,
                wantInput(u, { ...rest, ...(resolved ? { wantId: resolved } : {}) }),
                testDeps,
              ),
            u,
          )
          ids.push(outcome.ok ? outcome.value.want.id : null)
          outcomes.push(
            outcome.ok
              ? `ok:${outcome.value.created ? 'created' : outcome.value.changed ? 'changed' : 'unchanged'}:${outcome.value.want.centreId ?? '-'}`
              : outcome.error.code,
          )
        } else if (step.kind === 'active') {
          const outcome = await t.as(
            'nabvy_app',
            (q) =>
              setActive(
                q,
                { userId: u, wantId: resolve(step.ref) ?? '', active: step.active ?? true },
                testDeps,
              ),
            u,
          )
          ids.push(null)
          outcomes.push(
            outcome.ok
              ? `ok:${outcome.value.changed ? 'changed' : 'unchanged'}`
              : outcome.error.code,
          )
        } else {
          const outcome = await t.as(
            'nabvy_app',
            (q) => deleteWant(q, { userId: u, wantId: resolve(step.ref) ?? '' }),
            u,
          )
          ids.push(null)
          outcomes.push(outcome.ok ? 'ok:deleted' : outcome.error.code)
        }
      }

      const wants = await t.sql(
        `select centre_id as centre, active from want_manager.wants where user_id = $1 order by created_at`,
        [u],
      )
      const terms = rows(
        await t.as('nabvy_pipeline', (q) =>
          q.execute(
            'select centre_id, family, want_count::int as n, paid_want_count::int as paid from want_manager.v_want_terms_by_centre order by 1, 2',
          ),
        ),
      )
      const areas = rows(
        await t.as('nabvy_pipeline', (q) =>
          q.execute(
            'select centre_id, lat, lng, radius_km, accepts_delivery from want_manager.v_want_areas order by 1, 2, 3',
          ),
        ),
      )
      const [parts] = rows(
        await t.as('nabvy_pipeline', (q) =>
          q.execute('select count(*)::int as n from want_manager.v_want_parts'),
        ),
      )
      const [pipeline] = rows(
        await t.as('nabvy_pipeline', (q) =>
          q.execute('select count(*)::int as n from want_manager.v_wants'),
        ),
      )

      expect({
        outcomes,
        wants: wants.map((w) => `${w.centre ?? '-'}:${w.active ? 'active' : 'paused'}`),
        terms: terms.map((r) => `${r.centre_id}/${r.family}=${r.n}/${r.paid}`),
        areas: areas.map(
          (r) =>
            `${r.centre_id}@${r.lat},${r.lng}:${r.radius_km}${r.accepts_delivery ? '+post' : ''}`,
        ),
        parts: (parts as { n: number }).n,
        pipelineWants: (pipeline as { n: number }).n,
      }).toEqual(expected)
    })
  }
})
