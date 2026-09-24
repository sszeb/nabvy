import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const script = join(here, 'check-conventions.mjs')
const fixture = (name) => join(here, 'fixtures/conventions', name)

// Runs the checker against a fixture directory and returns { code, output } (stdout + stderr).
function run(name) {
  const result = spawnSync('node', [script, fixture(name)], { encoding: 'utf8' })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

test('timeouts: flags a vitest.config.ts missing testTimeout', () => {
  const { code, output } = run('timeouts')
  assert.equal(code, 1)
  assert.match(output, /timeouts missing testTimeout: 30000/)
})

test('view-invoker: flags a create view without security_invoker', () => {
  const { code, output } = run('view-invoker')
  assert.equal(code, 1)
  assert.match(output, /view-invoker create view without security_invoker/)
})

test('function-search-path: flags a function with no search_path and no revoke', () => {
  const { code, output } = run('function-search-path')
  assert.equal(code, 1)
  assert.match(output, /function-search-path example\.unsafe has no set search_path/)
  assert.match(output, /function-search-path example\.unsafe has no matching revoke/)
})

test('no-process-env: flags a use outside packages/config, honours the matching allowlist', () => {
  const { code, output } = run('no-process-env')
  assert.equal(code, 1)
  const lines = output.split('\n').filter((l) => l.includes('no-process-env'))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /src\/bad\.ts:1/)
})

test('readme-decisions: flags a module README with no Decisions heading', () => {
  const { code, output } = run('readme-decisions')
  assert.equal(code, 1)
  assert.match(output, /readme-decisions missing "## Decisions" heading/)
})

test('backlog-ids: warns without failing CI', () => {
  const { code, output } = run('backlog-ids')
  assert.equal(code, 0)
  assert.match(output, /warning:.*backlog-ids cites backlog id 9\.9z/)
})

test('module-json: flags a migrations folder with no module.json, exempts better-auth', () => {
  const { code, output } = run('module-json')
  assert.equal(code, 1)
  assert.match(
    output,
    /migrations\/example\/module\.json:1 module-json missing or invalid module\.json/,
  )
  assert.ok(!output.includes('better-auth'))
})

test('module-shape: flags a service missing its test/ directory', () => {
  const { code, output } = run('module-shape')
  assert.equal(code, 1)
  assert.match(output, /module-shape missing test/)
})
