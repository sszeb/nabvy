import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  confirmTelegramLink,
  createTelegramLinkCode,
  exportAccount,
  updateProfile,
} from '../../src'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `export`: the JSON archive a user downloads (docs/decisions.md:119: no enforcement
// reason, evidence, rule, signal or score). Each case optionally sets up a profile and a Telegram
// link, then calls exportAccount() and checks the shape and channel count.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  userId: z.string(),
  setUpProfile: z.boolean().default(false),
  setUpTelegramLink: z.boolean().default(false),
})
const Expected = z.strictObject({
  hasProfile: z.boolean(),
  channelCount: z.number().int(),
  channelKinds: z.array(z.enum(['telegram', 'push'])),
})

const casesDir = new URL('./cases/', import.meta.url)
const read = (id: string, file: string): unknown =>
  JSON.parse(readFileSync(new URL(`${id}/${file}`, casesDir), 'utf8'))
const cases = readdirSync(casesDir)
  .sort()
  .flatMap((id) => {
    const parsed = Input.safeParse(read(id, 'input.json'))
    return parsed.success
      ? [{ id, input: parsed.data, expected: Expected.parse(read(id, 'expected.json')) }]
      : []
  })

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('account', 'module', 'on')`,
  )
}, 60_000)
afterAll(() => db.close())

describe('export', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    if (input.setUpProfile) {
      await db.as(
        'nabvy_app',
        (tx) => updateProfile(tx, { userId: input.userId, displayName: 'Fixture User' }),
        input.userId,
      )
    }
    if (input.setUpTelegramLink) {
      const { code } = await db.as(
        'nabvy_app',
        (tx) => createTelegramLinkCode(tx, { userId: input.userId, sessionId: 'session-fixture' }),
        input.userId,
      )
      await db.as('nabvy_pipeline', (tx) =>
        confirmTelegramLink(tx, { code, chatId: 'chat-fixture' }),
      )
    }

    const record = await db.as(
      'nabvy_app',
      (tx) => exportAccount(tx, { userId: input.userId }),
      input.userId,
    )

    expect(record.userId).toBe(input.userId)
    expect(Boolean(record.profile)).toBe(expected.hasProfile)
    expect(record.channels).toHaveLength(expected.channelCount)
    expect(record.channels.map((c) => c.kind).sort()).toEqual([...expected.channelKinds].sort())
    // No enforcement reason, evidence, rule, signal or score, whatever the account holds.
    expect(JSON.stringify(record)).not.toMatch(/reason|evidence|score|signal/i)
  })
})
