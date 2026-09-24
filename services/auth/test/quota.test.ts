import { loadEnv } from '@nabvy/config'
import { createDb, type DbHandle } from '@nabvy/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { consumeMagicLinkQuota } from '../src/auth'
import { createTestDatabase, type TestDatabase } from './support/database'

// The per-address magic-link counter: 5 an hour, one atomic statement per request.

const HOUR = 3600 * 1000

describe('magic-link quota (PGlite, as nabvy_auth)', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  }, 60_000)

  afterAll(async () => {
    await database.close()
  })

  it('allows 5 in a window, refuses the rest, and opens again when the window ends', async () => {
    const start = Date.UTC(2026, 8, 24, 12)
    const results: boolean[] = []
    for (let i = 0; i < 7; i++) {
      results.push(await consumeMagicLinkQuota(database.db, 'Window@Example.com', start + i * 1000))
    }
    expect(results).toEqual([true, true, true, true, true, false, false])
    // The same address in another case shares the counter.
    expect(await consumeMagicLinkQuota(database.db, ' window@example.com', start + 10_000)).toBe(
      false,
    )
    expect(await consumeMagicLinkQuota(database.db, 'window@example.com', start + HOUR)).toBe(true)
    // The key holds a hash of the address, never the address.
    const rows = await database.sql('select key from better_auth.rate_limit')
    expect(JSON.stringify(rows)).not.toContain('window@example.com')
  })
})

// Concurrency needs separate connections, which PGlite does not have. Runs when DATABASE_URL
// points at a local database with the migrations applied (after pnpm db:dry-run), as the
// migration role, switching to nabvy_auth; skipped otherwise.
function localDatabaseUrl(): string | undefined {
  try {
    const url = loadEnv(['database']).DATABASE_URL
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ? url : undefined
  } catch {
    return undefined
  }
}

const url = localDatabaseUrl()

describe.skipIf(!url)('magic-link quota (Postgres, 20 connections at once)', () => {
  let handle: DbHandle
  const email = 'concurrent-quota@example.com'

  beforeAll(() => {
    handle = createDb(url as string, { max: 20, options: '-c role=nabvy_auth' })
  })

  afterAll(async () => {
    await handle.db.execute(
      sql`delete from better_auth.rate_limit where key like 'nabvy:magic-link-email:%'`,
    )
    await handle.pool.end()
  })

  it('lets exactly 5 of 20 simultaneous requests through', async () => {
    const now = Date.now()
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeMagicLinkQuota(handle.db, email, now)),
    )
    expect(results.filter(Boolean)).toHaveLength(5)
  })
})
