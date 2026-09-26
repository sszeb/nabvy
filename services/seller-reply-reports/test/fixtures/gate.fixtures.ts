import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canReport } from '../../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedListing,
  seedUser,
  setSwitches,
  suppressListing,
  type TestDatabase,
  testDeps,
} from '../support/database'
import { casesOf, readCase } from '../support/scenario'

// Stage "gate": whether the report sheet is offered (design §3.1, §6.2): notifier's open 5 minutes
// to 14 days ago, messaging not off, not suppressed, an active account; in shadow, testers only.
// Synthetic: the open record is injected (notifier is not merged).

interface GateCase {
  synthetic: true
  minutesSinceOpen: number | null
  messagingEnabled: boolean | null
  suppressed?: boolean
  switch?: 'on' | 'shadow'
  tester?: boolean
  banned?: boolean
}

const NOW = new Date('2026-09-25T12:00:00.000Z')
const USER = '0190f1d2-0000-7000-8000-000000000001'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

describe('gate', () => {
  for (const id of casesOf('gate')) {
    it(id, async () => {
      const input = readCase(id, 'input.json') as GateCase
      expect(input.synthetic).toBe(true)
      await setSwitches(t, { ...ALL_ON, 'seller-reply-reports': input.switch ?? 'on' })
      await seedUser(t, USER, 90, NOW)
      const listing = await seedListing(t, id)
      if (input.suppressed) await suppressListing(t, id)
      if (input.tester) {
        await t.sql(
          'insert into seller_reply_reports.testers (user_id, added_by, audit_id, added_at) values ($1, $1, nabvy_core.uuidv7(), now())',
          [USER],
        )
      }
      if (input.banned)
        await t.sql('update better_auth."user" set banned = true where id = $1', [USER])
      const deps = testDeps({
        opens:
          input.minutesSinceOpen === null
            ? {}
            : { [listing]: new Date(NOW.getTime() - input.minutesSinceOpen * 60_000) },
        flags: { [listing]: { messagingEnabled: input.messagingEnabled, shippingOffered: null } },
      })
      const answer = await t.as(
        'nabvy_app',
        (q) => canReport(q, { userId: USER, listingIds: [listing] }, deps, { now: NOW }),
        USER,
      )
      if (!answer.ok) throw new Error(answer.error.message)
      expect({ allowed: answer.value[0]?.allowed }).toEqual(readCase(id, 'expected.json'))
    })
  }
})
