import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { list, submit } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'

// Rule 11 of docs/design/modules/_rules.md: off acknowledges and writes nothing, and the internal
// view returns no rows; shadow runs and writes, and the internal view shows rows (waitlist has no
// user-facing view for shadow to hide). No module reads waitlist yet (module card, "Depends on"),
// so there is no reader fixture suite to re-run with this module off.
//
// Writes to the switches table go through raw SQL, not `@nabvy/db/schema/switches`: a module may
// only import another module's v_ views (packages/db/README.md, "Views"; enforced by
// packages/db/test/conventions.test.ts).

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('off', () => {
  it('submit refuses and writes nothing', async () => {
    const result = await harness.as('nabvy_app', (db) =>
      submit(db, { email: 'closed@example.com' }, { state: 'off', ip: '203.0.113.20' }),
    )
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'waitlist.closed' }),
    })
    const rows = await harness.as('nabvy_pipeline', (db) => list(db))
    expect(rows.some((row) => row.email === 'closed@example.com')).toBe(false)
  })

  it('the internal view hides an existing row while the switches row is off (unset)', async () => {
    await harness.as('nabvy_app', (db) =>
      submit(db, { email: 'view-check@example.com' }, { state: 'on', ip: '203.0.113.21' }),
    )
    // No row in switches.switches for 'waitlist' yet: switches.state('waitlist') defaults to
    // 'off' (an unknown name reads off), so the view must hide the row submit() just wrote.
    const rows = await harness.as('nabvy_pipeline', (db) => list(db))
    expect(rows.some((row) => row.email === 'view-check@example.com')).toBe(false)
  })
})

describe('shadow and on', () => {
  it('the internal view shows rows once the switch reads shadow, and still on', async () => {
    await harness.as('postgres', (db) =>
      db.execute(
        sql`insert into switches.switches (name, kind, state) values ('waitlist', 'module', 'shadow')`,
      ),
    )
    let rows = await harness.as('nabvy_pipeline', (db) => list(db))
    expect(rows.some((row) => row.email === 'view-check@example.com')).toBe(true)

    await harness.as('postgres', (db) =>
      db.execute(sql`update switches.switches set state = 'on' where name = 'waitlist'`),
    )
    rows = await harness.as('nabvy_pipeline', (db) => list(db))
    expect(rows.some((row) => row.email === 'view-check@example.com')).toBe(true)
  })
})
