import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scaffoldModule, validateName } from '../../../scripts/new-module.mjs'
import { plan } from '../scripts/migrate.mjs'
import { repoRoot } from './paths'

// Proves `pnpm new:module` on a throwaway module in a temporary copy of the tree; nothing is
// written to the repository. CI also scaffolds a probe module end to end (typecheck, tests,
// db:generate, dry-run): .github/workflows/ci.yml, job "Migration dry-run".

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'nabvy-scaffold-'))
  roots.push(root)
  mkdirSync(join(root, 'packages', 'contracts'), { recursive: true })
  writeFileSync(
    join(root, 'packages', 'contracts', 'package.json'),
    readFileSync(join(repoRoot, 'packages', 'contracts', 'package.json')),
  )
  return root
}

describe('pnpm new:module', () => {
  it('creates the module, its contract file, its schema file and its migrations home', () => {
    const root = tempRoot()
    const written = scaffoldModule({ root, name: 'throwaway-probe' })
    for (const path of [
      'services/throwaway-probe/README.md',
      'services/throwaway-probe/package.json',
      'services/throwaway-probe/src/index.ts',
      'services/throwaway-probe/src/handlers/index.ts',
      'services/throwaway-probe/src/domain/index.ts',
      'services/throwaway-probe/src/repo/index.ts',
      'services/throwaway-probe/test/throwaway-probe.test.ts',
      'services/throwaway-probe/test/fixtures/sample.json',
      'packages/contracts/src/modules/throwaway-probe.ts',
      'packages/db/src/schema/throwaway-probe.ts',
      'packages/db/migrations/throwaway-probe/module.json',
      'packages/db/migrations/throwaway-probe/drizzle.config.ts',
    ]) {
      expect(written).toContain(path)
      expect(existsSync(join(root, path)), path).toBe(true)
    }

    const readme = readFileSync(join(root, 'services/throwaway-probe/README.md'), 'utf8')
    for (const section of [
      'Job',
      'Inputs',
      'Outputs',
      'Owned tables',
      'Views',
      'Events',
      'When switched off',
      'Tests',
    ]) {
      expect(readme).toContain(`\n## ${section}\n`)
    }
    const pkg = JSON.parse(
      readFileSync(join(root, 'services/throwaway-probe/package.json'), 'utf8'),
    )
    expect(pkg.name).toBe('@nabvy/throwaway-probe')
    expect(readFileSync(join(root, 'packages/db/src/schema/throwaway-probe.ts'), 'utf8')).toContain(
      "moduleSchema('throwaway-probe')",
    )
  })

  it('produces a migrations home the runner accepts', () => {
    const root = tempRoot()
    scaffoldModule({ root, name: 'throwaway-probe' })
    const dir = join(root, 'packages/db/migrations')
    mkdirSync(join(dir, 'core'))
    writeFileSync(join(dir, 'core', 'module.json'), '{"module":"core","schema":"nabvy_core"}')
    writeFileSync(join(dir, 'throwaway-probe', '20260924000000_throwaway_probe.sql'), 'select 1;')
    expect(plan(dir).map((m) => m.module)).toEqual(['throwaway-probe'])
  })

  it('refuses to overwrite a module and refuses bad or reserved names', () => {
    const root = tempRoot()
    scaffoldModule({ root, name: 'throwaway-probe' })
    expect(() => scaffoldModule({ root, name: 'throwaway-probe' })).toThrow(/already exists/)
    for (const name of [undefined, 'Bad_Name', 'auth', 'storage', 'core', 'db', 'nabvy-core']) {
      expect(() => validateName(name)).toThrow()
    }
    expect(validateName('copy-advert-spam')).toBe('copy_advert_spam')
  })
})
