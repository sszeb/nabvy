import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { record, retry } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'

// incidents cannot be switched off (docs/design/modules/incidents.md, "When off": the task
// runner needs it) and has no entry in `switches` (packages/db/README.md has no such table for
// this module; only core + incidents migrations are applied here). Two checks: the module's own
// source never reads a switch, and record()/retry() work with nothing resembling a switches
// table in the database at all.

const srcDir = join(import.meta.dirname, '../src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  )
}

describe('incidents has no switch', () => {
  it('never reads a switches table or is_on/state helper from its own source', () => {
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/switches\.|is_on\(|switches\.state\(/)
    }
  })

  let harness: TestDatabase

  beforeAll(async () => {
    harness = await createTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await harness.close()
  })

  it('records and retries with no switches table present at all', async () => {
    const envelope = {
      id: '00000000-0000-7000-8000-000000000001',
      type: 'listing-ingest.first-seen',
      v: 1,
      at: '2026-09-24T00:00:00.000Z',
      key: 'facebook:switch-off:abc',
      payload: { listingIds: ['00000000-0000-7000-8000-000000000002'] },
    }
    const input = {
      envelope,
      error: { code: 'listing-ingest.timeout', message: 'boom' },
      attempts: 3,
      firstFailedAt: '2026-09-24T00:00:00.000Z',
    }

    const { incident } = await harness.as('nabvy_pipeline', (db) => record(db, input))
    const result = await harness.as('nabvy_app', (db) => retry(db, incident.id))
    expect(result.ok).toBe(true)
  })
})
