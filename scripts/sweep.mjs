#!/usr/bin/env node
// One-call input for the coordinator's sweep (coordinator 12, 2026-09-25).
// Prints, from the repository alone: merged modules (services/* on origin/main), the modules
// docs/progress.md shows as open (PR number in the row) or building (no PR yet), the ready
// modules from scripts/critical-path.mjs with those lists, the migration plan (to compare with
// nabvy_core.schema_migrations in one SQL call), the per-module question files to fold, and
// the sessions of every module not yet done. Nothing here calls GitHub or Supabase.
// Usage: node scripts/sweep.mjs [--no-fetch] [--open=a,b] [--building=c,d]
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.replace(/^--/, '').split('='))
    .map(([k, v]) => [k, v === undefined ? true : v]),
)
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
if (!args['no-fetch']) sh('git fetch -q origin main')
const idx = JSON.parse(readFileSync(new URL('../docs/design/modules/index.json', import.meta.url)))
const names = new Set(idx.map((m) => m.name))
const merged = sh('git ls-tree --name-only origin/main services/')
  .split('\n')
  .map((p) => p.replace('services/', ''))
  .filter((n) => names.has(n))

const rows = readFileSync(new URL('../docs/progress.md', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => /^\| [a-z0-9.-]+ \| \d+ \|/.test(l))
  .map((l) => l.split('|').map((c) => c.trim()))
  .map(([, name, round, status, session]) => ({
    name,
    round,
    status,
    // the newest session named in the row: a fresh finishing session is named in the status text
    session: [...`${session} ${status}`.matchAll(/session_\w+/g)].map((m) => m[0]).pop() || '',
  }))
  .filter((r) => names.has(r.name))
const notDone = rows.filter((r) => !merged.includes(r.name) && !/\bdone:/.test(r.status))
const open = args.open
  ? args.open.split(',')
  : notDone.filter((r) => /PR #\d+|#\d+ to main/.test(r.status)).map((r) => r.name)
const building = args.building
  ? args.building.split(',')
  : notDone.filter((r) => !/PR #\d+|#\d+ to main/.test(r.status)).map((r) => r.name)

console.log(`main ${sh('git rev-parse --short origin/main')}; merged modules ${merged.length}`)
console.log(`open (PR in progress row): ${open.join(', ') || 'none'}`)
console.log(`building (no PR yet): ${building.join(', ') || 'none'}`)
console.log('--- critical path')
console.log(
  sh(
    `node scripts/critical-path.mjs --done=${merged.join(',')} --open=${open.join(',')} --building=${building.join(',')}`,
  )
    .split('\n')
    .filter((l) => !/^\s+blocked/.test(l))
    .join('\n'),
)
console.log('--- sessions of modules not done (progress.md)')
for (const r of notDone)
  console.log(`${r.name}: ${r.session.replace(/`/g, '')}; ${r.status.slice(-90)}`)
console.log(
  "--- migration plan (compare with: select module || '/' || name from nabvy_core.schema_migrations)",
)
const plan = sh('node packages/db/scripts/migrate.mjs plan')
  .split('\n')
  .map((l) => l.split(/\s+/)[0])
console.log(`${plan.length} files; last: ${plan.slice(-4).join(' ')}`)
const q = existsSync('docs/questions')
  ? readdirSync('docs/questions').filter((f) => f.endsWith('.md'))
  : []
console.log(`--- question files to fold: ${q.length ? q.join(' ') : 'none'}`)
