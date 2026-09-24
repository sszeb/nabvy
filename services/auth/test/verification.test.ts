import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { guardSessionCreation } from '../src/auth'
import { createHarness, type Harness, signInByMagicLink } from './support/harness'

// Email verification is required before any session exists (docs/security.md), whatever creates
// it: the session hook refuses an unverified address, such as a Google account whose email Google
// has not verified. A magic link verifies the address before its session is made.

let harness: Harness

beforeAll(async () => {
  harness = await createHarness()
}, 60_000)

afterAll(async () => {
  await harness.close()
})

async function unverifiedUser(email: string): Promise<string> {
  const [row] = await harness.database.sql(
    `insert into better_auth."user" (name, email, email_verified) values ('', $1, false) returning id`,
    [email],
  )
  return row?.id as string
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await harness.database.sql(
    'select count(*)::int as n from better_auth.session where user_id = $1',
    [userId],
  )
  return Number(row?.n)
}

describe('email verification', () => {
  it('fails closed when a session is created outside a request', async () => {
    const id = await unverifiedUser('outside@example.com')
    const context = await harness.auth.$context
    expect(await context.internalAdapter.createSession(id)).toBeNull()
    expect(await sessionCount(id)).toBe(0)
  })

  it('a magic link verifies an unverified account before its session', async () => {
    const id = await unverifiedUser('late.verifier@example.com')
    await signInByMagicLink(harness, 'late.verifier@example.com')
    expect(await sessionCount(id)).toBe(1)
  })
})

describe('the session guard', () => {
  function context(user: Record<string, unknown> | null) {
    const updates: Record<string, unknown>[] = []
    return {
      updates,
      ctx: {
        context: {
          internalAdapter: {
            findUserById: async () => user,
            updateUser: async (_id: string, data: Record<string, unknown>) => {
              updates.push(data)
              return null
            },
          },
        },
      },
    }
  }
  const guard = guardSessionCreation(['founder@example.com'])
  const base = { id: 'u1', email: 'someone@example.com', emailVerified: true, role: 'user' }

  it('refuses an unverified address, e.g. a Google account Google has not verified', async () => {
    const { ctx } = context({ ...base, emailVerified: false })
    await expect(guard({ userId: 'u1' }, ctx)).rejects.toMatchObject({
      body: { code: 'EMAIL_NOT_VERIFIED' },
    })
  })

  it('refuses a restricted account with the notice only', async () => {
    const { ctx } = context({
      ...base,
      banned: true,
      banExpires: null,
      banReason: 'internal',
      restrictionPolicy: 'fair-use',
    })
    const error = await guard({ userId: 'u1' }, ctx).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      body: {
        code: 'ACCOUNT_RESTRICTED',
        message: 'Your account has been banned under our Fair Use Policy.',
      },
    })
    expect(JSON.stringify((error as { body: unknown }).body)).not.toContain('internal')
  })

  it('promotes a founder and admits a verified user', async () => {
    const founder = context({ ...base, email: 'Founder@example.com' })
    await expect(guard({ userId: 'u1' }, founder.ctx)).resolves.toBeUndefined()
    expect(founder.updates).toEqual([{ role: 'admin' }])
    const plain = context(base)
    await expect(guard({ userId: 'u1' }, plain.ctx)).resolves.toBeUndefined()
    expect(plain.updates).toEqual([])
  })

  it('fails closed with no request context or no user', async () => {
    await expect(guard({ userId: 'u1' }, null)).resolves.toBe(false)
    await expect(guard({ userId: 'u1' }, context(null).ctx)).resolves.toBe(false)
  })
})
