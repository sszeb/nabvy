import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RouterError, route, table } from '../../src'
import type { TestDatabase } from './database'
import { harness, type Recorded } from './fake'

// One fixture case: a recorded provider answer replayed through table() or route() on the real
// migrations in PGlite. The observed value is the result, or the RouterError code.

const casesDir = fileURLToPath(new URL('../fixtures/cases/', import.meta.url))

export const caseIds = (): string[] => readdirSync(casesDir).sort()

interface CaseInput {
  kind: 'table' | 'route'
  input: unknown
  response: Recorded
}

const read = (id: string, file: string) =>
  JSON.parse(readFileSync(join(casesDir, id, file), 'utf8'))

export async function runCase(
  db: TestDatabase,
  id: string,
): Promise<{ observed: unknown; expected: unknown }> {
  const { kind, input, response } = read(id, 'input.json') as CaseInput
  const { deps } = harness(db, response)
  let observed: unknown
  try {
    const result =
      kind === 'table' ? await table(input as never, deps) : await route(input as never, deps)
    observed = { ok: result }
  } catch (error) {
    if (!(error instanceof RouterError)) throw error
    observed = { error: error.code }
  }
  return { observed, expected: read(id, 'expected.json') }
}
