// pnpm db:seed — creates or promotes the founder users from ADMIN_EMAILS (docs/engineering.md,
// "Admin bootstrap") by calling better_auth.seed_founders. Runs with psql as the migration role,
// like the runner (PG* variables), because the application roles cannot reach better_auth.
// Idempotent. The UK H3 cells seed is not built: search planning uses verified city-page centres
// instead (docs/decisions.md, Precedence, "Search planning").
import { spawnSync } from 'node:child_process'
import { loadEnv } from '@nabvy/config'

const { ADMIN_EMAILS } = loadEnv(['auth'])
const result = spawnSync(
  'psql',
  ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', `emails=${ADMIN_EMAILS.join(',')}`, '-f', '-'],
  {
    input: "select better_auth.seed_founders(string_to_array(:'emails', ','));\n",
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  },
)
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`founder seed: ${result.stdout.trim()} user(s) created or promoted`)
