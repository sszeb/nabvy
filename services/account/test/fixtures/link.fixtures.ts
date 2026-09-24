import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { confirmTelegramLink, createTelegramLinkCode } from '../../src'
import { createTestDatabase, type TestDatabase } from '../support/database'

// Stage `link`: Telegram single-use link codes (services/account/README.md, "Telegram and push
// binding"). Each case issues a code, then confirms it `confirmTimes` times against `chatId`,
// optionally tampering with the code first. Expected: the last confirmation's outcome and the
// final row count in `account.telegram_links`.

const Input = z.strictObject({
  synthetic: z.literal(true),
  source: z.string().min(1),
  userId: z.string(),
  sessionId: z.string(),
  chatId: z.string(),
  tamper: z.enum(['none', 'expire']).default('none'),
  confirmTimes: z.number().int().min(1).max(3).default(1),
})
const Expected = z.union([
  z.strictObject({ linked: z.literal(true), linkRows: z.number().int() }),
  z.strictObject({ refused: z.string(), linkRows: z.number().int() }),
])

// One `cases/` folder is shared by every stage in this module (rule 16); each stage file keeps
// only the case directories whose input.json parses against its own Input schema.
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

describe('link', () => {
  it.each(cases)('$id', async ({ input, expected }) => {
    const { code } = await db.as(
      'nabvy_app',
      (tx) => createTelegramLinkCode(tx, { userId: input.userId, sessionId: input.sessionId }),
      input.userId,
    )
    if (input.tamper === 'expire') {
      const codeHash = createHash('sha256').update(code).digest('hex')
      await db.sql(
        `update account.telegram_link_codes set expires_at = now() - interval '1 minute' where code_hash = $1`,
        [codeHash],
      )
    }

    let outcome: { linked: true } | { refused: string } = { refused: 'not-run' }
    for (let i = 0; i < input.confirmTimes; i++) {
      outcome = await db
        .as('nabvy_pipeline', (tx) => confirmTelegramLink(tx, { code, chatId: input.chatId }))
        .then(
          () => ({ linked: true as const }),
          (error: { code?: string }) => ({ refused: error.code ?? 'unknown' }),
        )
    }

    const rows = await db.sql(
      `select count(*)::int as n from account.telegram_links where user_id = $1 and revoked_at is null`,
      [input.userId],
    )
    const linkRows = Number(rows[0]?.n)
    if ('linked' in expected) {
      expect(outcome).toEqual({ linked: true })
    } else {
      expect(outcome).toEqual({ refused: expected.refused })
    }
    expect(linkRows).toBe(expected.linkRows)
  })
})
