import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Until per-module database roles exist (rule 4 of docs/design/modules/_rules.md), grants cannot tell one pipeline
// package from another, so this test does (actor-integration.md 3.3 and 3.5):
//   * only this package queues gateway jobs (enqueue_run) or reads the gateway's tables;
//   * only the seller-data allowlist (rule 6 of docs/design/modules/_rules.md) reads
//     restricted_rows;
//   * only the Edge Function names Apify's API host: Apify is called only through the gateway
//     (CLAUDE.md).
// Scans every TypeScript, JavaScript and SQL file outside node_modules, except the gateway's own
// schema, migrations and SQL tests, which define these objects.

const root = fileURLToPath(new URL('../../../', import.meta.url))
const self = 'services/apify-gateway/'
const SCAN = ['apps', 'services', 'packages', 'trigger', 'scripts', 'supabase']
const DEFINERS = [
  'packages/db/src/schema/apify-gateway.ts',
  'packages/db/migrations/apify-gateway/',
  'packages/db/tests/apify-gateway.test.sql',
  'supabase/migrations/',
  'supabase/tests/',
  'supabase/functions/apify-gateway/',
]
const SELLER_DATA_ALLOWLIST = [
  'services/seller-key/',
  'services/copy-advert/',
  'services/relist-merge/',
  'services/asking-price-index/',
  'services/listing-suppression/',
  'services/seller-rights/',
  'services/output-guard/',
]

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      return ['node_modules', 'dist', '.turbo'].includes(entry.name) ? [] : walk(path)
    return /\.(ts|tsx|mts|js|mjs|sql)$/.test(entry.name) ? [path] : []
  })
}

const files = SCAN.flatMap((dir) => walk(join(root, dir)))
  .map((path) => relative(root, path))
  .filter((path) => !DEFINERS.some((prefix) => path.startsWith(prefix)))
// Code only: comments may name the gateway's objects (as this one does).
const text = (path: string) =>
  readFileSync(join(root, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, '$1')
    .replace(/^\s*--.*$/gm, '')
const offenders = (pattern: RegExp, allowed: (path: string) => boolean) =>
  files.filter((path) => !allowed(path) && pattern.test(text(path)))

describe('who may reach the gateway', () => {
  it('scans the repository', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('services/apify-gateway/src/repo/index.ts')
  })

  it('only this package queues jobs or reads the gateway tables', () => {
    const pattern =
      /apify_gateway\s*\.\s*(enqueue_run|jobs|items|settings|claim_next_job)\b|from\s+['"]@nabvy\/db\/schema\/apify-gateway['"]/
    // Readers' test support (listing-ingest, detail-evidence, run-coverage, relist-merge,
    // listing-suppression, parts-rules, copy-advert) seeds collected jobs into the gateway's tables
    // in PGlite (never a live database), so their fixtures read the real views.
    const seeders = [
      'services/listing-ingest/test/support/',
      'services/detail-evidence/test/support/',
      'services/run-coverage/test/support/',
      'services/listing-suppression/test/support/',
      'services/relist-merge/test/support/',
      'services/parts-rules/test/support/',
      'services/copy-advert/test/support/',
    ]
    const found = offenders(
      pattern,
      (path) => path.startsWith(self) || seeders.some((prefix) => path.startsWith(prefix)),
    )
    // Other packages read the published views through their v-prefixed Drizzle exports only.
    const viewsOnly = found.filter((path) => {
      const imports = [
        ...text(path).matchAll(
          /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s+['"]@nabvy\/db\/schema\/apify-gateway['"]/g,
        ),
      ]
      const names = imports.flatMap((m) =>
        (m[1] ?? '').split(',').map((n) => n.trim().replace(/^type\s+/, '')),
      )
      const other = text(path).replace(/import[^;]*@nabvy\/db\/schema\/apify-gateway['"]/g, '')
      return (
        imports.length > 0 && names.every((n) => !n || /^v[A-Z]/.test(n)) && !pattern.test(other)
      )
    })
    expect(found.filter((path) => !viewsOnly.includes(path))).toEqual([])
  })

  it('only the seller-data allowlist reads restricted_rows', () => {
    expect(
      offenders(/(?<![a-z_])restricted_rows\b|\brestrictedRows\b/, (path) =>
        [self, ...SELLER_DATA_ALLOWLIST].some((prefix) => path.startsWith(prefix)),
      ),
    ).toEqual([])
  })

  it('only the Edge Function calls Apify', () => {
    expect(
      offenders(/api\.apify\.com/, (path) => path === `${self}test/conventions.test.ts`),
    ).toEqual([])
  })
})
