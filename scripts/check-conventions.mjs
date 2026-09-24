#!/usr/bin/env node
// Convention checks not otherwise caught by typecheck, lint or tests (task 0.9d).
// Usage: node scripts/check-conventions.mjs [rootDir]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const fixturesDir = join(root, 'scripts/fixtures/conventions')
const attempt = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}
function walk(dir, matches, out = []) {
  const entries = attempt(() => readdirSync(dir, { withFileTypes: true })) ?? []
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = join(dir, e.name)
    if (p === fixturesDir) continue
    if (e.isDirectory()) walk(p, matches, out)
    else if (matches(e.name)) out.push(p)
  }
  return out
}
const listDirNames = (e) => e.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
const dirs = (parent) =>
  attempt(() => listDirNames(readdirSync(parent, { withFileTypes: true }))) ?? []
const tryRead = (file) => attempt(() => readFileSync(file, 'utf8'))
const tryParse = (file) => attempt(() => JSON.parse(readFileSync(file, 'utf8')))
const exists = (path) => attempt(() => statSync(path)) !== null
const v = (file, line, rule, message) => ({ file: relative(root, file), line, rule, message })
// 1. timeouts: every services/*/vitest.config.ts sets both timeouts.
function checkTimeouts() {
  const need = { hookTimeout: 60000, testTimeout: 30000 }
  return walk(join(root, 'services'), (n) => n === 'vitest.config.ts').flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return Object.entries(need)
      .filter(([key, ms]) => !new RegExp(`${key}:\\s*${ms}`).test(text))
      .map(([key, ms]) => v(file, 1, 'timeouts', `missing ${key}: ${ms}`))
  })
}
// 2. view-invoker: every create view in packages/db/migrations is security_invoker.
function checkViewInvoker() {
  return walk(join(root, 'packages/db/migrations'), (n) => n.endsWith('.sql')).flatMap((file) => {
    const lines = readFileSync(file, 'utf8').split('\n')
    return lines.flatMap((line, i) => {
      if (!/create\s+(?:or\s+replace\s+)?view\s+/i.test(line)) return []
      const header = lines.slice(i, i + 5).join('\n') // options can trail onto the next few lines
      return /security_invoker\s*=\s*(?:true|on|1)/i.test(header)
        ? []
        : [v(file, i + 1, 'view-invoker', 'create view without security_invoker = true')]
    })
  })
}
// 3. function-search-path: header sets search_path; a revoke, exact or schema-wide, covers it
// somewhere in the migration history — grants persist across create-or-replace.
const SCHEMA_FN = '([a-z_][a-z0-9_]*)\\.([a-z_][a-z0-9_]*)\\s*\\('
const WIDE_REVOKE = /revoke\s+all\s+on\s+all\s+functions\s+in\s+schema\s+([a-z_][a-z0-9_]*)/i
const FN_REVOKE = /revoke\s+all\s+on\s+function/i
const FN_NAME = new RegExp(SCHEMA_FN, 'gi')
const FN_DEF = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${SCHEMA_FN}`, 'i')
function collectRevokes(sqlDirs) {
  const bySig = new Set()
  const bySchema = new Set()
  const stmts = sqlDirs
    .flatMap((d) => walk(d, (n) => n.endsWith('.sql')))
    .flatMap((f) => readFileSync(f, 'utf8').split(';'))
  for (const stmt of stmts) {
    const wide = WIDE_REVOKE.exec(stmt)
    if (wide) bySchema.add(wide[1].toLowerCase())
    else if (FN_REVOKE.test(stmt) && /\bpublic\b/i.test(stmt))
      for (const [, s, n] of stmt.matchAll(FN_NAME))
        bySig.add(`${s.toLowerCase()}.${n.toLowerCase()}`)
  }
  return { bySig, bySchema }
}
function checkFunctionSearchPath() {
  const dbMigrations = join(root, 'packages/db/migrations')
  const { bySig, bySchema } = collectRevokes([dbMigrations, join(root, 'supabase/migrations')])
  return walk(dbMigrations, (n) => n.endsWith('.sql')).flatMap((file) => {
    const lines = readFileSync(file, 'utf8').split('\n')
    return lines.flatMap((line, i) => {
      const m = FN_DEF.exec(line)
      if (!m) return []
      const fn = `${m[1].toLowerCase()}.${m[2].toLowerCase()}`
      let end = i
      while (end < lines.length && !/\$\$|\bas\s*\$/.test(lines[end])) end++
      const header = lines.slice(i, end + 1).join('\n')
      const out = []
      const report = (msg) => out.push(v(file, i + 1, 'function-search-path', msg))
      if (!/set\s+search_path/i.test(header)) report(`${fn} has no set search_path in its header`)
      if (!bySchema.has(fn.split('.')[0]) && !bySig.has(fn))
        report(`${fn} has no matching revoke ... from public`)
      return out
    })
  })
}
// 4. no-process-env: reads env only under packages/config/.
function checkNoProcessEnv() {
  const configDir = `${join(root, 'packages/config')}/`
  const isTracked = (n) => /\.(ts|tsx|mjs|js|cjs)$/.test(n)
  const files = walk(root, isTracked).filter((f) => !`${f}/`.startsWith(configDir))
  const needle = ['process', 'env'].join('.')
  const msg = `${needle} used outside packages/config`
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => (line.includes(needle) ? [v(file, i + 1, 'no-process-env', msg)] : [])),
  )
}
// 5. readme-decisions: every services/<module>/README.md has a "## Decisions" heading.
function checkReadmeDecisions() {
  const servicesDir = join(root, 'services')
  return dirs(servicesDir).flatMap((name) => {
    const readme = join(servicesDir, name, 'README.md')
    const text = tryRead(readme)
    if (text === null) return [v(readme, 1, 'readme-decisions', 'missing README.md')]
    if (/^## Decisions\s*$/m.test(text)) return []
    return [v(readme, 1, 'readme-decisions', 'missing "## Decisions" heading')]
  })
}
// 6. backlog-ids (warning only: renumbered on the coordinator's branch, never fails CI).
function checkBacklogIds() {
  const backlogFile = join(root, 'docs/backlog.md')
  const backlogText = tryRead(backlogFile)
  if (backlogText === null) return []
  const known = new Set([...backlogText.matchAll(/^-\s+\*\*(\S+)\s/gm)].map((m) => m[1]))
  const idPattern = /(?:backlog|task)\s+(\d+\.\d+[a-z]?)\b|\((\d+\.\d+[a-z]?)\)/gi
  const files = walk(join(root, 'docs'), (n) => n.endsWith('.md')).filter((f) => f !== backlogFile)
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        [...line.matchAll(idPattern)].flatMap((m) => {
          const id = m[1] ?? m[2]
          const msg = `cites backlog id ${id}, not found as "- **${id} " in docs/backlog.md`
          return known.has(id) ? [] : [v(file, i + 1, 'backlog-ids', msg)]
        }),
      ),
  )
}
// 7. module-json: every packages/db/migrations/<dir> except better-auth has module.json.dependsOn.
function checkModuleJson() {
  const migrationsDir = join(root, 'packages/db/migrations')
  return dirs(migrationsDir)
    .filter((name) => name !== 'better-auth')
    .flatMap((name) => {
      const file = join(migrationsDir, name, 'module.json')
      const parsed = tryParse(file)
      if (!parsed) return [v(file, 1, 'module-json', 'missing or invalid module.json')]
      if (Array.isArray(parsed.dependsOn)) return []
      return [v(file, 1, 'module-json', 'module.json has no dependsOn array')]
    })
}
// 8. module-shape: every services/<module>/ has README.md, src/index.ts and test/.
function checkModuleShape() {
  const servicesDir = join(root, 'services')
  return dirs(servicesDir).flatMap((name) => {
    const dir = join(servicesDir, name)
    return ['README.md', 'src/index.ts', 'test']
      .filter((required) => !exists(join(dir, required)))
      .map((required) => v(dir, 1, 'module-shape', `missing ${required}`))
  })
}
const checkers = [
  { rule: 'timeouts', run: checkTimeouts },
  { rule: 'view-invoker', run: checkViewInvoker },
  { rule: 'function-search-path', run: checkFunctionSearchPath },
  { rule: 'no-process-env', run: checkNoProcessEnv },
  { rule: 'readme-decisions', run: checkReadmeDecisions },
  { rule: 'backlog-ids', run: checkBacklogIds, warnOnly: true },
  { rule: 'module-json', run: checkModuleJson },
  { rule: 'module-shape', run: checkModuleShape },
]
function isAllowlisted(violation) {
  const text = attempt(() => readFileSync(join(root, violation.file), 'utf8'))
  const line = text?.split('\n')[violation.line - 1] ?? ''
  return /(?:\/\/|--)\s*convention-check:\s*ignore\s+(\S+)/.exec(line)?.[1] === violation.rule
}
export function runChecks() {
  const failing = []
  const warnings = []
  for (const { run, warnOnly } of checkers)
    (warnOnly ? warnings : failing).push(...run().filter((item) => !isAllowlisted(item)))
  return { failing, warnings }
}
const format = (item) => `${item.file}:${item.line} ${item.rule} ${item.message}`
function main() {
  const { failing, warnings } = runChecks()
  for (const item of warnings) console.warn(`warning: ${format(item)}`)
  for (const item of failing) console.error(format(item))
  if (failing.length > 0) {
    console.error(`\n${failing.length} convention violation(s).`)
    process.exit(1)
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main()
