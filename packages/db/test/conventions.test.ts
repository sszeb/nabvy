import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dbRoot, repoRoot } from './paths'

// Static checks on the ownership conventions in README.md, over the whole repository, so a
// module branch that breaks them fails CI without anyone editing this file.

const migrationsDir = join(dbRoot, 'migrations')
const schemaDir = join(dbRoot, 'src', 'schema')
const modules = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('module layout', () => {
  it.each(modules.filter((m) => m !== 'core'))('%s has a schema file and a Drizzle config', (m) => {
    expect(existsSync(join(schemaDir, `${m}.ts`)), `src/schema/${m}.ts`).toBe(true)
    const config = readFileSync(join(migrationsDir, m, 'drizzle.config.ts'), 'utf8')
    expect(config).toContain(`schema: './src/schema/${m}.ts'`)
    expect(config).toContain(`out: './migrations/${m}'`)
    expect(config).toContain(`schemaFilter: ['${m.replaceAll('-', '_')}']`)
    expect(config).toContain(`prefix: 'supabase'`)
  })

  it('every schema file has a migrations home', () => {
    for (const file of readdirSync(schemaDir)) {
      expect(modules, `migrations/${file.replace(/\.ts$/, '')}/`).toContain(
        file.replace(/\.ts$/, ''),
      )
    }
  })

  it('no table is declared outside a module schema', () => {
    for (const file of walk(schemaDir)) {
      expect(readFileSync(file, 'utf8'), relative(repoRoot, file)).not.toMatch(/\bpgTable\(/)
    }
  })
})

describe('cross-module access', () => {
  const services = readdirSync(join(repoRoot, 'services'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  // Every import or re-export whose source is a module schema file, by package path or by a
  // relative path into packages/db/src/schema.
  const statementPattern =
    /(?:import|export)\s[^;]*?from\s+['"]((?:@nabvy\/db\/schema\/|[^'"]*packages\/db\/src\/schema\/)([a-z0-9-]+)(?:\.ts)?)['"]/g
  const namedPattern = /^(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from/

  /** Problems with one statement that reaches another module's schema file, or none. */
  function problems(statement: string, owner: string): string[] {
    const named = namedPattern.exec(statement.trim())
    if (!named)
      return [`${owner}: only named imports of v_ views are allowed, not "${statement.trim()}"`]
    return (named[1] ?? '')
      .split(',')
      .map(
        (name) =>
          name
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0] ?? '',
      )
      .filter(Boolean)
      .filter((name) => !/^v[A-Z]/.test(name))
      .map((name) => `${owner}: ${name} is not a v_ view`)
  }

  it('recognises every import form', () => {
    const forms = [
      "import { hunts } from '@nabvy/db/schema/hunt-manager'",
      "import * as hunt from '@nabvy/db/schema/hunt-manager'",
      "export { hunts } from '@nabvy/db/schema/hunt-manager'",
      "export * from '@nabvy/db/schema/hunt-manager'",
      "import { hunts } from '../../../packages/db/src/schema/hunt-manager.ts'",
    ]
    for (const form of forms) {
      const [match] = [...form.matchAll(statementPattern)]
      expect(match?.[2], form).toBe('hunt-manager')
      expect(problems(match?.[0] ?? '', 'hunt-manager').length, form).toBeGreaterThan(0)
    }
    const [allowed] = [
      ..."import { type vHunts, vHunts as v } from '@nabvy/db/schema/hunt-manager'".matchAll(
        statementPattern,
      ),
    ]
    expect(problems(allowed?.[0] ?? '', 'hunt-manager')).toEqual([])
  })

  it.skipIf(services.length === 0).each(services)(
    '%s reads other modules’ schemas only through v_ views',
    (service) => {
      for (const file of walk(join(repoRoot, 'services', service))) {
        for (const match of readFileSync(file, 'utf8').matchAll(statementPattern)) {
          const [statement, , owner] = match
          if (owner === service) continue
          expect(problems(statement, owner ?? ''), relative(repoRoot, file)).toEqual([])
        }
      }
    },
  )
})
