import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RESERVED_SCHEMAS as SCAFFOLD_RESERVED,
  validateName,
} from '../../../scripts/new-module.mjs'
import { moduleSchema, RESERVED_SCHEMAS, schemaNameOf } from '../src/index'
import { dbRoot } from './paths'

describe('module schemas', () => {
  it('maps a kebab-case module to its snake-case schema', () => {
    expect(schemaNameOf('listing-registry')).toBe('listing_registry')
    expect(moduleSchema('copy-advert-spam').schemaName).toBe('copy_advert_spam')
  })

  it('refuses reserved and malformed names', () => {
    for (const name of ['auth', 'storage', 'public', 'extensions', 'nabvy-core', 'pg-stat']) {
      expect(() => schemaNameOf(name)).toThrow()
    }
    expect(() => schemaNameOf('Listing_Registry')).toThrow(/kebab/)
  })

  it('reserves the same schemas as the scaffold', () => {
    expect([...RESERVED_SCHEMAS].sort()).toEqual([...SCAFFOLD_RESERVED].sort())
  })
})

// The module → schema rule lives in four places: schemaNameOf() here, the scaffold, the runner's
// module.json check, and the SQL that finds module schemas from the migration ledger
// (view_violations() and the dry-run tests). These tests pin them together so they cannot drift.
describe('module → schema name, everywhere', () => {
  const migrationsDir = join(dbRoot, 'migrations')
  const testsDir = join(dbRoot, 'tests')
  // What the SQL does: replace(module, '-', '_').
  const sqlRule = (module: string) => module.split('-').join('_')

  it('agrees between schemaNameOf, the scaffold and the SQL rule', () => {
    for (const name of ['a', 'hunt-manager', 'copy-advert-spam', 'price-book-2', 'x1-y2-z3']) {
      expect(validateName(name), name).toBe(schemaNameOf(name))
      expect(sqlRule(name), name).toBe(schemaNameOf(name))
    }
  })

  it('matches every committed module.json', () => {
    for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'core') continue
      const manifest = JSON.parse(
        readFileSync(join(migrationsDir, entry.name, 'module.json'), 'utf8'),
      )
      expect(manifest.schema, entry.name).toBe(schemaNameOf(entry.name))
    }
  })

  it('is the only rule the SQL uses to derive a schema from a module name', () => {
    const sqlFiles = [
      ...readdirSync(migrationsDir, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.sql'))
        .map((file) => join(migrationsDir, file)),
      ...readdirSync(testsDir)
        .filter((file) => file.endsWith('.sql'))
        .map((file) => join(testsDir, file)),
    ]
    let derivations = 0
    for (const file of sqlFiles) {
      for (const [call] of readFileSync(file, 'utf8').matchAll(
        /replace\(\s*[\w.]*module\b[^)]*\)/g,
      )) {
        derivations++
        expect(call.replace(/\s+/g, ' '), file).toMatch(/^replace\([\w.]*module, '-', '_'\)$/)
      }
    }
    // view_violations() in the hardening migration, plus the dry-run checks.
    expect(derivations).toBeGreaterThanOrEqual(2)
  })
})
