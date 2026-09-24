import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const dbRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
export const repoRoot = join(dbRoot, '..', '..')
