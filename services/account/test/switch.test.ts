import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getStanding, isActive, setStanding, updateProfile } from '../src'
import { AccountRefused } from '../src/domain'
import { createTestDatabase, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000c1'
const ADMIN = '00000000-0000-4000-8000-0000000000a1'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into better_auth."user" (id, name, email) values ($1, 'Test', 'test@example.com')`,
    [U1],
  )
}, 60_000)

afterAll(() => db.close())

describe('account off (rule 11 default for a new module: no seed row, so the switch reads off)', () => {
  it('refuses a profile write', async () => {
    await expect(
      db.as('nabvy_app', (tx) => updateProfile(tx, { userId: U1, displayName: 'Alex' }), U1),
    ).rejects.toMatchObject({ code: 'account.module_off' })
  })

  it('refuses setStanding', async () => {
    await expect(
      db.as('nabvy_pipeline', (tx) =>
        setStanding(
          tx,
          { actorUserId: ADMIN, userId: U1, status: 'active', reason: 'no-op' },
          {
            restrictAccount: async () => {},
            liftRestriction: async () => {},
          },
        ),
      ),
    ).rejects.toBeInstanceOf(AccountRefused)
  })

  it('v_channels and v_standing still return their rows (rule 11: exempt from the filter)', async () => {
    await db.sql(
      `insert into switches.switches (name, kind, state) values ('account', 'module', 'on')`,
    )
    await db.as('nabvy_pipeline', (tx) =>
      setStanding(
        tx,
        { actorUserId: ADMIN, userId: U1, status: 'active', reason: 'seed' },
        { restrictAccount: async () => {}, liftRestriction: async () => {} },
      ),
    )
    await db.sql(`update switches.switches set state = 'off' where name = 'account'`)
    const rows = await db.sql(`select status from account.v_standing where user_id = $1`, [U1])
    expect(rows).toHaveLength(1)
  })

  it('isActive() is unaffected either way: it never reads this module\'s switch (rule 11: "if account is off, suspensions and bans already recorded still apply")', async () => {
    expect(await db.as('nabvy_app', (tx) => isActive(tx, U1))).toBe(true)
  })
})

describe('account on', () => {
  it('writes and reads through the module normally', async () => {
    await db.sql(`update switches.switches set state = 'on' where name = 'account'`)
    const profile = await db.as(
      'nabvy_app',
      (tx) => updateProfile(tx, { userId: U1, displayName: 'Alex' }),
      U1,
    )
    expect(profile.displayName).toBe('Alex')
    const standing = await db.as('nabvy_pipeline', (tx) => getStanding(tx, U1))
    expect(standing?.status).toBe('active')
  })
})
