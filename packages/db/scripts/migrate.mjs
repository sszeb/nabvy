// The migration runner (packages/db/README.md, "Migrations").
//
//   node scripts/migrate.mjs plan            print every migration in apply order, with checksums
//   node scripts/migrate.mjs apply           apply pending migrations with psql (PG* variables)
//   node scripts/migrate.mjs emit <m>/<file> print one migration plus its ledger row, for applying
//                                            through the Supabase connector (coordinator)
//
// Order: modules are sorted by the `dependsOn` lists in migrations/<module>/module.json (core
// first, ties by name); inside a module, files run in file-name (timestamp) order. Each file runs
// in one transaction with its row in nabvy_core.schema_migrations; a file whose checksum differs
// from the recorded one stops the run (migrations are forward-only and never edited once merged).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const MODULE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const FILE_NAME = /^\d{14}_[a-z0-9_]+\.sql$/

/** Reads every module folder and returns the migrations in apply order. */
export function plan(dir = migrationsDir) {
  const modules = new Map()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(dir, entry.name, 'module.json')
    if (!existsSync(manifestPath)) throw new Error(`${entry.name}: missing module.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.module !== entry.name || !MODULE_NAME.test(entry.name)) {
      throw new Error(`${entry.name}/module.json: "module" must be the folder name, kebab case`)
    }
    const expectedSchema = entry.name === 'core' ? 'nabvy_core' : entry.name.replaceAll('-', '_')
    if (manifest.schema !== expectedSchema) {
      throw new Error(`${entry.name}/module.json: "schema" must be "${expectedSchema}"`)
    }
    const dependsOn = manifest.dependsOn ?? []
    if (entry.name !== 'core' && !dependsOn.includes('core')) {
      throw new Error(`${entry.name}/module.json: "dependsOn" must include "core"`)
    }
    const files = readdirSync(join(dir, entry.name))
      .filter((file) => file.endsWith('.sql'))
      .sort()
    for (const file of files) {
      if (!FILE_NAME.test(file)) {
        throw new Error(`${entry.name}/${file}: name must be <14-digit timestamp>_<slug>.sql`)
      }
    }
    modules.set(entry.name, { dependsOn, files })
  }
  if (!modules.has('core')) throw new Error('migrations/core is missing')

  for (const [name, { dependsOn }] of modules) {
    for (const dependency of dependsOn) {
      if (!modules.has(dependency))
        throw new Error(`${name} depends on unknown module ${dependency}`)
    }
  }

  // Kahn's algorithm, always taking the alphabetically first ready module, so the order is stable.
  const order = []
  const done = new Set()
  while (order.length < modules.size) {
    const ready = [...modules.keys()]
      .filter((name) => !done.has(name))
      .filter((name) => modules.get(name).dependsOn.every((dependency) => done.has(dependency)))
      .sort()
    if (ready.length === 0) {
      const left = [...modules.keys()].filter((name) => !done.has(name))
      throw new Error(`Dependency cycle among modules: ${left.join(', ')}`)
    }
    order.push(ready[0])
    done.add(ready[0])
  }

  return order.flatMap((module) =>
    modules.get(module).files.map((name) => {
      const path = join(dir, module, name)
      const sql = readFileSync(path, 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      return { module, name, path, sql, checksum }
    }),
  )
}

const quote = (text) => `'${text.replaceAll("'", "''")}'`

const bootstrapSql = `
set client_min_messages = warning;
create schema if not exists nabvy_core;
create table if not exists nabvy_core.schema_migrations (
  module text not null,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now(),
  primary key (module, name)
);`

/** The ledger row for a migration, run in the same transaction as the migration itself. */
export function ledgerSql({ module, name, checksum }) {
  return `insert into nabvy_core.schema_migrations (module, name, checksum) values (${quote(module)}, ${quote(name)}, ${quote(checksum)});`
}

// Supabase's default search path, so unqualified extension types (vector, geography) resolve.
const searchPath = `set search_path = "$user", public, extensions; set client_min_messages = warning;`

function psql(args) {
  const result = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.status !== 0) throw new Error(`psql failed (exit ${result.status})`)
  return result.stdout
}

function apply() {
  psql(['-c', bootstrapSql])
  const applied = new Map(
    psql([
      '-At',
      '-F',
      ' ',
      '-c',
      'select module, name, checksum from nabvy_core.schema_migrations',
    ])
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [module, name, checksum] = line.split(' ')
        return [`${module}/${name}`, checksum]
      }),
  )
  let count = 0
  for (const migration of plan()) {
    const id = `${migration.module}/${migration.name}`
    const recorded = applied.get(id)
    if (recorded === migration.checksum) continue
    if (recorded !== undefined) {
      throw new Error(
        `${id} was edited after it was applied (checksum differs); add a new migration instead`,
      )
    }
    console.log(`apply  ${id}`)
    psql(['-1', '-c', searchPath, '-f', migration.path, '-c', ledgerSql(migration)])
    count++
  }
  console.log(`${count} migration(s) applied`)
}

function emit(id) {
  const migration = plan().find((m) => `${m.module}/${m.name}` === id)
  if (!migration) throw new Error(`No migration ${id}; run "plan" to list them`)
  process.stdout.write(`${searchPath}\n${migration.sql.trimEnd()}\n${ledgerSql(migration)}\n`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const [command, argument] = process.argv.slice(2)
  try {
    if (command === 'plan') {
      for (const m of plan()) console.log(`${m.module}/${m.name}  ${m.checksum.slice(0, 12)}`)
    } else if (command === 'apply') {
      apply()
    } else if (command === 'emit' && argument) {
      emit(argument)
    } else {
      console.error('usage: migrate.mjs plan | apply | emit <module>/<file>')
      process.exit(2)
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
