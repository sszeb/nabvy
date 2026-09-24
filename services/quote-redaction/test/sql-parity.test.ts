import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectors } from '../src/domain/index'

// The SQL twin (quote_redaction.redact_result) must carry the same detectors in the same order:
// each row is (step, kind, flags, mask, source), masks with \1 where TypeScript writes $1.
const dir = new URL('../../../packages/db/migrations/quote-redaction/', import.meta.url)
const file = readdirSync(dir).find((f) => f.endsWith('_quote_redaction_functions.sql'))
const sql = readFileSync(new URL(file as string, dir), 'utf8')

describe('SQL parity', () => {
  it('finds the migration', () => {
    expect(file).toBeDefined()
  })

  it.each(detectors.map((d, i) => [i + 1, d] as const))('detector %i', (step, d) => {
    const mask = d.mask.replace(/\$(\d)/g, '\\$1')
    const row = `(${step}, '${d.kind}', '${d.flags}', '${mask}',\n        '${d.source}')`
    expect(d.source).not.toContain("'")
    expect(sql).toContain(row)
  })

  it('has no detector the TypeScript lacks', () => {
    expect(sql.match(/^ {6}\(\d+, '/gm)).toHaveLength(detectors.length)
  })
})
