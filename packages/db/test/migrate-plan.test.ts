import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { guardSql, ledgerSql, plan } from '../scripts/migrate.mjs'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Layout = Record<string, { dependsOn?: string[]; schema?: string; files: string[] }>

function layout(modules: Layout): string {
  const dir = mkdtempSync(join(tmpdir(), 'nabvy-plan-'))
  dirs.push(dir)
  for (const [module, { dependsOn, schema, files }] of Object.entries(modules)) {
    mkdirSync(join(dir, module))
    const defaultSchema = module === 'core' ? 'nabvy_core' : module.replaceAll('-', '_')
    writeFileSync(
      join(dir, module, 'module.json'),
      JSON.stringify({
        module,
        schema: schema ?? defaultSchema,
        dependsOn: dependsOn ?? (module === 'core' ? [] : ['core']),
      }),
    )
    for (const file of files) writeFileSync(join(dir, module, file), `-- ${module}/${file}\n`)
  }
  return dir
}

const ids = (dir: string) => plan(dir).map((m) => `${m.module}/${m.name}`)

describe('migration plan', () => {
  it('puts core first, then modules by dependency, then alphabetically; files by timestamp', () => {
    const dir = layout({
      core: { files: ['20260101000000_core.sql'] },
      'price-book': { files: ['20260105000000_b.sql', '20260102000000_a.sql'] },
      valuation: { dependsOn: ['core', 'price-book'], files: ['20260101000001_v.sql'] },
      alerts: { files: ['20260109000000_x.sql'] },
    })
    expect(ids(dir)).toEqual([
      'core/20260101000000_core.sql',
      'alerts/20260109000000_x.sql',
      'price-book/20260102000000_a.sql',
      'price-book/20260105000000_b.sql',
      'valuation/20260101000001_v.sql',
    ])
  })

  it('does not depend on timestamps across modules, so parallel branches merge in any order', () => {
    const dir = layout({
      core: { files: ['20260101000000_core.sql'] },
      reader: { dependsOn: ['core', 'writer'], files: ['20250101000000_early.sql'] },
      writer: { files: ['20270101000000_late.sql'] },
    })
    expect(ids(dir)).toEqual([
      'core/20260101000000_core.sql',
      'writer/20270101000000_late.sql',
      'reader/20250101000000_early.sql',
    ])
  })

  it('refuses cycles, unknown dependencies, a missing core link and bad names', () => {
    expect(() =>
      plan(
        layout({
          core: { files: [] },
          a: { dependsOn: ['core', 'b'], files: [] },
          b: { dependsOn: ['core', 'a'], files: [] },
        }),
      ),
    ).toThrow(/cycle/)
    expect(() =>
      plan(layout({ core: { files: [] }, a: { dependsOn: ['core', 'ghost'], files: [] } })),
    ).toThrow(/unknown module ghost/)
    expect(() => plan(layout({ core: { files: [] }, a: { dependsOn: [], files: [] } }))).toThrow(
      /must include "core"/,
    )
    expect(() => plan(layout({ core: { files: ['001_init.sql'] } }))).toThrow(/timestamp/)
    expect(() => plan(layout({ core: { files: [] }, a: { schema: 'other', files: [] } }))).toThrow(
      /"schema" must be "a"/,
    )
  })

  it('checksums file contents and quotes the ledger row', () => {
    const [migration] = plan(layout({ core: { files: ['20260101000000_core.sql'] } }))
    expect(migration?.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(ledgerSql({ module: "o'brien", name: 'n', checksum: 'c' })).toContain("'o''brien'")
    const guard = guardSql({ module: "o'brien", name: 'n.sql' })
    expect(guard).toMatch(/^select pg_advisory_xact_lock\(\d+\);/)
    expect(guard).toContain("module = 'o''brien' and name = 'n.sql'")
  })

  it('plans the committed migrations with core first', () => {
    const committed = plan()
    expect(committed[0]?.module).toBe('core')
    expect(committed.map((m) => m.module)).toContain('better-auth')
  })
})
