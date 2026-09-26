// `pnpm test:fixtures`: runs every fixture suite found by convention, prints the pass rate per module
// and stage, per stage and per module, and exits non-zero when a stage falls below the module's
// previous recorded run. `--record` writes the current rates as the new recorded run; a drop is
// recorded only with `--accept-drop`. `--module <path>` limits the run to one or more packages.
//
// Runs under Node's type stripping, so imports inside this package carry `.ts` extensions.

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startVitest, type TestModule } from 'vitest/node'
import {
  formatReport,
  isFailing,
  judge,
  nextBaselines,
  type SuiteRun,
  tallyRuns,
} from './domain/report.ts'
import { readBaselines, writeBaseline } from './repo/baselines.ts'
import { discoverSuites, type Suite } from './repo/discover.ts'

const { values } = parseArgs({
  options: {
    record: { type: 'boolean', default: false },
    'accept-drop': { type: 'boolean', default: false },
    module: { type: 'string', multiple: true },
  },
})

const root = resolve(import.meta.dirname, '../../..')
const discovery = discoverSuites(root)
const only = values.module?.map((m) => m.replace(/\/+$/, ''))
const modules = only ?? discovery.modules
const suites = discovery.suites.filter((suite) => modules.includes(suite.module))

for (const module of only ?? []) {
  if (!discovery.modules.includes(module)) {
    console.error(`No fixture suites in ${module} (expected ${module}/test/fixtures/).`)
    process.exit(1)
  }
}
if (discovery.misnamed.length > 0) {
  console.error(
    `Suite files must be named <stage>[.<suite>].fixtures.ts (lower-case, hyphens):\n  ${discovery.misnamed.join('\n  ')}`,
  )
  process.exit(1)
}

const runSuites = async (list: Suite[]): Promise<SuiteRun[]> => {
  if (list.length === 0) return []
  const vitest = await startVitest('test', [], {
    root,
    config: false,
    include: list.map((suite) => suite.file),
    watch: false,
    passWithNoTests: true,
    reporters: [{}],
    hookTimeout: 120000,
    testTimeout: 60000,
  })
  const byPath = new Map(list.map((suite) => [resolve(root, suite.file), suite]))
  const runs = vitest.state.getTestModules().map((testModule: TestModule): SuiteRun => {
    const suite = byPath.get(testModule.moduleId)
    if (!suite) throw new Error(`Vitest ran an unexpected file: ${testModule.moduleId}`)
    const run: SuiteRun = { ...suite, passed: 0, failed: 0, skipped: 0, failures: [], errors: [] }
    for (const test of testModule.children.allTests()) {
      const result = test.result()
      if (result.state === 'passed') run.passed++
      else if (result.state === 'failed') {
        run.failed++
        const message = result.errors[0]?.message.split('\n')[0] ?? 'failed'
        run.failures.push(`${test.fullName}: ${message}`)
      } else run.skipped++
    }
    for (const error of testModule.errors()) run.errors.push(error.message.split('\n')[0] ?? '')
    return run
  })
  for (const suite of list) {
    if (!runs.some((run) => run.file === suite.file)) {
      runs.push({ ...suite, passed: 0, failed: 0, skipped: 0, failures: [], errors: ['not run'] })
    }
  }
  const unhandled = vitest.state.getUnhandledErrors()
  await vitest.close()
  if (unhandled.length > 0) {
    console.error('Unhandled errors during the fixture run:', unhandled)
    process.exit(1)
  }
  return runs
}

const verdicts = judge(tallyRuns(await runSuites(suites)), readBaselines(root, modules), modules)
console.log(formatReport(verdicts))

if (values.record) {
  const { baselines, refused } = nextBaselines(verdicts, values['accept-drop'])
  for (const [module, stages] of Object.entries(baselines)) writeBaseline(root, module, stages)
  console.log(`\nRecorded pass rates for ${Object.keys(baselines).length} module(s).`)
  if (refused.length > 0) {
    console.error(
      `Not recorded (errored, or dropped without --accept-drop): ${refused.map((v) => `${v.module} · ${v.stage}`).join(', ')}`,
    )
    process.exitCode = 1
  } else process.exitCode = 0
} else {
  process.exitCode = verdicts.some(isFailing) ? 1 : 0
}
