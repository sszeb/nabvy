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
  // Schemas whose owning service has another name. `auth` is a reserved Supabase schema, so the
  // auth module's Better Auth tables live in `better_auth` (README.md, "Better Auth").
  const ownerOf: Record<string, string> = { 'better-auth': 'auth' }
  const importPattern =
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@nabvy\/db\/schema\/([a-z0-9-]+)'/g

  it.skipIf(services.length === 0).each(services)(
    '%s imports only v_ views from other modules’ schemas',
    (service) => {
      for (const file of walk(join(repoRoot, 'services', service))) {
        for (const match of readFileSync(file, 'utf8').matchAll(importPattern)) {
          const [, , names = '', owner] = match
          if (owner === service || ownerOf[owner ?? ''] === service) continue
          const imported = names
            .split(',')
            .map(
              (name) =>
                name
                  .trim()
                  .split(/\s+as\s+/)[0]
                  ?.replace(/^type\s+/, '') ?? '',
            )
            .filter(Boolean)
          for (const name of imported) {
            expect(name, `${relative(repoRoot, file)} imports ${name} from ${owner}`).toMatch(
              /^v[A-Z]/,
            )
          }
        }
      }
    },
  )
})
