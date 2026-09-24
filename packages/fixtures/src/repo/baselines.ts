import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Tallies, Tally } from '../domain/report.ts'
import { BASELINE_FILE, SUITE_DIR } from '../domain/suites.ts'

// Each module keeps its previous recorded run in `<package>/test/fixtures/pass-rates.json`, so
// parallel module branches never edit the same file.

const tallySchema = z
  .strictObject({ passed: z.int().nonnegative(), total: z.int().positive() })
  .refine((t) => t.passed <= t.total, 'passed exceeds total')

const baselineSchema = z.strictObject({ stages: z.record(z.string(), tallySchema) })

export const baselinePath = (root: string, module: string): string =>
  join(root, module, SUITE_DIR, BASELINE_FILE)

export const readBaselines = (root: string, modules: string[]): Tallies => {
  const out: Tallies = {}
  for (const module of modules) {
    const path = baselinePath(root, module)
    if (!existsSync(path)) continue
    const parsed = baselineSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`)
    out[module] = parsed.data.stages
  }
  return out
}

export const writeBaseline = (root: string, module: string, stages: Record<string, Tally>) => {
  const sorted = Object.fromEntries(Object.entries(stages).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(baselinePath(root, module), `${JSON.stringify({ stages: sorted }, null, 2)}\n`)
}
