import { WAITLIST_SUBMIT_PER_IP } from '@nabvy/config/modules/waitlist'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { submit } from '../src/index'
import { consumeSubmitQuota } from '../src/repo'
import { createTestDatabase, type TestDatabase } from './support/database'

// docs/security.md: public endpoints are rate limited per IP. Basis for the number: docs/questions.md,
// "waitlist: submission rate limit".

let harness: TestDatabase

beforeAll(async () => {
  harness = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('consumeSubmitQuota', () => {
  it(`allows exactly ${WAITLIST_SUBMIT_PER_IP.max} attempts per IP within the window`, async () => {
    const ip = '203.0.113.30'
    const results: boolean[] = []
    for (let i = 0; i < WAITLIST_SUBMIT_PER_IP.max + 1; i++) {
      results.push(await harness.as('nabvy_app', (db) => consumeSubmitQuota(db, ip)))
    }
    expect(results).toEqual([...Array(WAITLIST_SUBMIT_PER_IP.max).fill(true), false])
  })

  it('resets once the window has passed', async () => {
    const ip = '203.0.113.31'
    const start = Date.now()
    for (let i = 0; i < WAITLIST_SUBMIT_PER_IP.max; i++) {
      await harness.as('nabvy_app', (db) => consumeSubmitQuota(db, ip, start))
    }
    const blocked = await harness.as('nabvy_app', (db) => consumeSubmitQuota(db, ip, start))
    expect(blocked).toBe(false)

    const afterWindow = start + WAITLIST_SUBMIT_PER_IP.windowSeconds * 1000 + 1000
    const allowed = await harness.as('nabvy_app', (db) => consumeSubmitQuota(db, ip, afterWindow))
    expect(allowed).toBe(true)
  })

  it('counts separately per IP', async () => {
    const a = await harness.as('nabvy_app', (db) => consumeSubmitQuota(db, '203.0.113.40'))
    const b = await harness.as('nabvy_app', (db) => consumeSubmitQuota(db, '203.0.113.41'))
    expect(a).toBe(true)
    expect(b).toBe(true)
  })
})

describe('submit', () => {
  it('refuses once the IP is over quota', async () => {
    const ip = '203.0.113.50'
    for (let i = 0; i < WAITLIST_SUBMIT_PER_IP.max; i++) {
      await harness.as('nabvy_app', (db) =>
        submit(db, { email: `over-quota-${i}@example.com` }, { state: 'on', ip }),
      )
    }
    const result = await harness.as('nabvy_app', (db) =>
      submit(db, { email: 'one-too-many@example.com' }, { state: 'on', ip }),
    )
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'waitlist.rate_limited' }),
    })
  })
})
