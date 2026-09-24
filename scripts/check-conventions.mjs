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
const VIEW_DEF = /create\s+(?:or\s+replace\s+)?view\s+/gi
function checkViewInvoker() {
  return walk(join(root, 'packages/db/migrations'), (n) => n.endsWith('.sql')).flatMap((file) => {
    const text = readFileSync(file, 'utf8') // matched against the whole file, not line by line, so
    const out = [] // a view name or options trailing onto the next line is still found
    for (const m of text.matchAll(VIEW_DEF)) {
      const header = text.slice(m.index, m.index + 400)
      if (!/security_invoker\s*=\s*(?:true|on|1)/i.test(header)) {
        const line = text.slice(0, m.index).split('\n').length
        out.push(v(file, line, 'view-invoker', 'create view without security_invoker = true'))
      }
    }
    return out
  })
}
// 3. function-search-path: header sets search_path; a revoke, exact or schema-wide, covers it
// somewhere in the migration history — grants persist across create-or-replace. A revoke's
// argument list only ever carries types (`revoke ... on function f(text)`), while a definition's
// parameter list carries `name type`, so both are reduced to their bare type list before
// comparing; that also means a revoke for one overload never silently covers a different one.
// A definition's schema is optional in Postgres (it falls back to search_path); treat a bare
// name as `public`, same as the revoke checks below already assume.
const WIDE_REVOKE = /revoke\s+all\s+on\s+all\s+functions\s+in\s+schema\s+([a-z_][a-z0-9_]*)/i
const FN_REVOKE = /revoke\s+all\s+on\s+function/i
const SCHEMA_FN = /([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(/gi
const FN_DEF =
  /create\s+(?:or\s+replace\s+)?function\s+(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)\s*\(/gi
const BODY_MARKER = /\$\$|\bas\s*\$/i
// The text between a '(' at openIndex and its matching ')', respecting nesting (e.g. numeric(10,2)).
function matchParens(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(openIndex + 1, i)
  }
  return text.slice(openIndex + 1)
}
// Splits a raw parameter list on its top-level commas (not ones nested inside a type's parens).
function splitTopLevel(args) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of args) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts
}
// A parameter is `[mode] [name] type [default ...]`; only its type distinguishes an overload.
const paramType = (chunk) => {
  const tokens = chunk
    .replace(/\bdefault\b.*$/i, '')
    .trim()
    .split(/\s+/)
  return tokens[tokens.length - 1] ?? ''
}
const normalizeSig = (rawArgs) => {
  const trimmed = rawArgs.trim()
  return trimmed === '' ? '' : splitTopLevel(trimmed).map(paramType).join(',')
}
function collectRevokes(sqlDirs) {
  const bySig = new Set()
  const bySchema = new Set()
  const stmts = sqlDirs
    .flatMap((d) => walk(d, (n) => n.endsWith('.sql')))
    .flatMap((f) => readFileSync(f, 'utf8').split(';'))
  for (const stmt of stmts) {
    const wide = WIDE_REVOKE.exec(stmt)
    if (wide) bySchema.add(wide[1].toLowerCase())
    else if (FN_REVOKE.test(stmt) && /from\s+public\b/i.test(stmt))
      for (const m of stmt.matchAll(SCHEMA_FN)) {
        const args = matchParens(stmt, m.index + m[0].length - 1)
        bySig.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}(${normalizeSig(args)})`)
      }
  }
  return { bySig, bySchema }
}
function checkFunctionSearchPath() {
  const dbMigrations = join(root, 'packages/db/migrations')
  const { bySig, bySchema } = collectRevokes([dbMigrations, join(root, 'supabase/migrations')])
  return walk(dbMigrations, (n) => n.endsWith('.sql')).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    const out = []
    for (const m of text.matchAll(FN_DEF)) {
      const schema = (m[1] ?? 'public').toLowerCase()
      const name = m[2].toLowerCase()
      const fn = `${schema}.${name}`
      const args = matchParens(text, m.index + m[0].length - 1)
      const sig = `${fn}(${normalizeSig(args)})`
      const relEnd = text.slice(m.index).search(BODY_MARKER)
      const header = text.slice(m.index, relEnd === -1 ? text.length : m.index + relEnd)
      const line = text.slice(0, m.index).split('\n').length
      const report = (msg) => out.push(v(file, line, 'function-search-path', msg))
      if (!/set\s+search_path/i.test(header)) report(`${fn} has no set search_path in its header`)
      if (!bySchema.has(schema) && !bySig.has(sig))
        report(`${fn} has no matching revoke ... from public`)
    }
    return out
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
  // Anchored to the backlog-id shape (1-2 digits, a dot, 1-2 digits, an optional letter suffix)
  // so an unrelated decimal such as a cost figure "(0.0177)" isn't mistaken for a citation.
  const idPattern = /(?:backlog|task)\s+(\d{1,2}\.\d{1,2}[a-z]*)\b|\((\d{1,2}\.\d{1,2}[a-z]*)\)/gi
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
// 8. module-shape: every services/<module>/ has README.md, src/index.ts and test/. A violation
// points at the module directory, which has no line an allowlist comment could sit on, so this
// rule fails closed: it can never be silenced.
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
