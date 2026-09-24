import { entries } from '@nabvy/db/schema/waitlist'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { list, submit } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
  // These tests submit with ctx.state: 'on' (the caller's own read of the switch); the view
  // that list() reads checks the switches table independently (defence in depth, rule 5 of
  // _rules.md), so it needs a matching row too. Raw SQL, not `@nabvy/db/schema/switches`: a
  // module may only import another module's v_ views (packages/db/README.md, "Views").
  await harness.as('postgres', (db) =>
    db.execute(
      sql`insert into switches.switches (name, kind, state) values ('waitlist', 'module', 'on')`,
    ),
  )
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const on = { state: 'on' as const }

describe('submit (CLAUDE.md, "Idempotent handlers")', () => {
  it('writes one row for a repeat address and keeps the first entry', async () => {
    const input = {
      email: 'Sam@Example.com',
      postcode: 'po19 8hr',
      wantedProducts: ['RTX 3080'],
      utm: { source: 'reddit' },
    }

    const first = await harness.as('nabvy_app', (db) =>
      submit(db, input, { ...on, ip: '203.0.113.10' }),
    )
    const second = await harness.as('nabvy_app', (db) =>
      submit(
        db,
        { email: 'sam@example.com', postcode: 'sw1a 1aa', utm: { source: 'google' } },
        { ...on, ip: '203.0.113.11' },
      ),
    )

    expect(first).toEqual({
      ok: true,
      value: { entry: expect.objectContaining({ email: 'sam@example.com' }), created: true },
    })
    expect(second).toEqual({
      ok: true,
      value: { entry: expect.objectContaining({ email: 'sam@example.com' }), created: false },
    })
    if (second.ok) {
      expect(second.value.entry.postcode).toBe('PO19 8HR')
      expect(second.value.entry.utm).toEqual({ source: 'reddit' })
    }

    const rows = await harness.as('postgres', (db) => db.select().from(entries))
    expect(rows.filter((row) => row.email === 'sam@example.com')).toHaveLength(1)
  })
})

describe('list', () => {
  it('shows an entry written by submit', async () => {
    await harness.as('nabvy_app', (db) =>
      submit(db, { email: 'idempotency-list@example.com' }, { ...on, ip: '203.0.113.12' }),
    )
    const rows = await harness.as('nabvy_pipeline', (db) => list(db))
    expect(rows.some((row) => row.email === 'idempotency-list@example.com')).toBe(true)
  })
})
