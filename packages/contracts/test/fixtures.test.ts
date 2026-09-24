import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { exportNameOf, fixturesRoot, jsonFiles } from './discover'

// Round-trips every sample under fixtures/contracts/. Layout (packages/contracts/README.md):
//   fixtures/contracts/core/<Export>.<case>.json         parsed by the core export `<Export>`
//   fixtures/contracts/<module>/<Export>.<case>.json     parsed by src/modules/<module>.ts
//   .../invalid/<Export>.<case>.json                     must be rejected
// Module sessions add fixtures without editing this file.

const groups = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

async function load(group: string): Promise<Record<string, unknown>> {
  return group === 'core' ? import('../src/index') : import(`../src/modules/${group}.ts`)
}

function schemaFor(exports: Record<string, unknown>, group: string, file: string): z.ZodType {
  const name = exportNameOf(file)
  const candidate = exports[name] as { safeParse?: unknown } | undefined
  if (typeof candidate?.safeParse !== 'function') {
    throw new Error(`fixtures/contracts/${group}/${file}: no Zod schema exported as ${name}`)
  }
  return candidate as unknown as z.ZodType
}

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

describe.each(groups)('fixtures/contracts/%s', (group) => {
  const dir = join(fixturesRoot, group)
  const valid = jsonFiles(dir)
  const invalid = jsonFiles(join(dir, 'invalid'))

  it('has at least one valid sample', () => {
    expect(valid.length).toBeGreaterThan(0)
  })

  it.each(valid)('%s parses and round-trips unchanged', async (file) => {
    const schema = schemaFor(await load(group), group, file)
    const sample = read(join(dir, file))
    const parsed = schema.parse(sample)
    expect(parsed).toEqual(sample)
    expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })

  it.each(invalid)('invalid/%s is rejected', async (file) => {
    const schema = schemaFor(await load(group), group, file)
    expect(schema.safeParse(read(join(dir, 'invalid', file))).success).toBe(false)
  })
})
