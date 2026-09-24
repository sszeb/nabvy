import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(here, '..', '..', '..')
export const fixturesRoot = join(repoRoot, 'fixtures', 'contracts')
export const modulesDir = join(here, '..', 'src', 'modules')

/** Every per-module contract file, by module name (the file name without `.ts`). */
export function moduleFiles(dir: string = modulesDir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => file.slice(0, -'.ts'.length))
    .sort()
}

/** `<ExportName>.<case>.json` → `ExportName`. */
export function exportNameOf(file: string): string {
  const name = file.split('.')[0]
  if (!name) throw new Error(`Fixture ${file} must be named <ExportName>.<case>.json`)
  return name
}

export function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
}
