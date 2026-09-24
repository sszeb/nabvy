// pnpm db:generate <module> [--custom] [--name <slug>]
// Runs Drizzle Kit for one module only, with that module's own config and journal
// (migrations/<module>/drizzle.config.ts), so parallel branches never touch the same journal.
// --custom creates an empty timestamped SQL file for hand-written SQL (grants, RLS, views).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const db = join(dirname(fileURLToPath(import.meta.url)), '..')
const [module, ...rest] = process.argv.slice(2)
if (!module || module.startsWith('-')) {
  console.error('usage: pnpm db:generate <module> [--custom] [--name <slug>]')
  process.exit(2)
}
const config = join('migrations', module, 'drizzle.config.ts')
if (!existsSync(join(db, config))) {
  console.error(`No ${config}. Scaffold the module first: pnpm new:module ${module}`)
  process.exit(2)
}
const result = spawnSync('pnpm', ['exec', 'drizzle-kit', 'generate', '--config', config, ...rest], {
  cwd: db,
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
