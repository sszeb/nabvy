import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recordVerdict, setState } from '../../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from '../support/database'

// Stage "record": a sequence of recordVerdict/setState calls against one user and listing,
// synthetic (no recorded Facebook run needed: this module never reads listing content, only the
// user's own action). Each case checks the rows written and the view the user reads back.

interface Action {
  kind: 'verdict' | 'state'
  verdict?: 'real_deal' | 'not_a_deal' | 'bought'
  state?: 'saved' | 'dismissed'
  alertId?: string
}

interface Input {
  userId: string
  listingId: string
  actions: Action[]
}

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES).sort()
const NOW = new Date('2026-09-24T12:00:00.000Z')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

describe('record', () => {
  for (const id of cases) {
    it(id, async () => {
      const input = read(new URL(`${id}/input.json`, CASES)) as Input
      const expected = read(new URL(`${id}/expected.json`, CASES))

      await seedUser(t, input.userId, `${id}@example.com`)
      await setSwitches(t, ALL_ON)

      for (const action of input.actions) {
        const outcome =
          action.kind === 'verdict'
            ? await t.as(
                'nabvy_app',
                (q) =>
                  recordVerdict(
                    q,
                    {
                      userId: input.userId,
                      listingId: input.listingId,
                      alertId: action.alertId,
                      verdict: action.verdict as 'real_deal' | 'not_a_deal' | 'bought',
                    },
                    { now: NOW },
                  ),
                input.userId,
              )
            : await t.as(
                'nabvy_app',
                (q) =>
                  setState(
                    q,
                    {
                      userId: input.userId,
                      listingId: input.listingId,
                      state: action.state as 'saved' | 'dismissed',
                    },
                    { now: NOW },
                  ),
                input.userId,
              )
        if (!outcome.ok) throw new Error(outcome.error.message)
      }

      const [verdictRows] = (await t.sql(
        `select count(*)::int as n from listing_feedback.verdicts where user_id = $1`,
        [input.userId],
      )) as [{ n: number }]
      const [stateRows] = (await t.sql(
        `select count(*)::int as n from listing_feedback.listing_state where user_id = $1`,
        [input.userId],
      )) as [{ n: number }]
      const [boughtForReports] = (await t.sql(
        `select count(*)::int as n from listing_feedback.v_bought_for_reports where user_id = $1`,
        [input.userId],
      )) as [{ n: number }]
      const verdicts = await t.sql(
        `select verdict, alert_id as "alertId" from listing_feedback.verdicts
         where user_id = $1 order by created_at`,
        [input.userId],
      )
      const states = await t.sql(
        `select state from listing_feedback.listing_state where user_id = $1`,
        [input.userId],
      )

      expect({
        verdictRows: verdictRows.n,
        stateRows: stateRows.n,
        boughtForReports: boughtForReports.n,
        verdicts: verdicts.map((v) => `${v.verdict}${v.alertId ? `@${v.alertId}` : ''}`),
        finalState: states[0]?.state ?? null,
      }).toEqual(expected)
    })
  }
})
