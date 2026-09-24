import { describe, expect, it } from 'vitest'
import {
  formatReport,
  isFailing,
  judge,
  nextBaselines,
  type SuiteRun,
  tallyRuns,
} from '../src/index.ts'

const run = (over: Partial<SuiteRun>): SuiteRun => ({
  module: 'services/a',
  stage: 'gate',
  file: 'services/a/test/fixtures/gate.fixtures.ts',
  passed: 0,
  failed: 0,
  skipped: 0,
  failures: [],
  errors: [],
  ...over,
})

describe('tallyRuns', () => {
  it('sums suite files per module and stage and ignores skipped cases', () => {
    const tallies = tallyRuns([
      run({ passed: 3, failed: 1, skipped: 5, failures: ['x'] }),
      run({ file: 'services/a/test/fixtures/gate.more.fixtures.ts', passed: 2 }),
      run({ stage: 'risk', passed: 1 }),
    ])
    expect(tallies['services/a']?.gate).toEqual({
      passed: 5,
      total: 6,
      failures: ['x'],
      errors: [],
    })
    expect(tallies['services/a']?.risk?.total).toBe(1)
  })
})

describe('judge', () => {
  const current = tallyRuns([
    run({ stage: 'same', passed: 9, failed: 1 }),
    run({ stage: 'up', passed: 10 }),
    run({ stage: 'down', passed: 8, failed: 2 }),
    run({ stage: 'new', passed: 1 }),
    run({ stage: 'broken', errors: ['boom'] }),
    run({ stage: 'empty' }),
  ])
  const recorded = {
    'services/a': {
      same: { passed: 18, total: 20 },
      up: { passed: 9, total: 10 },
      down: { passed: 9, total: 10 },
      gone: { passed: 1, total: 1 },
    },
  }
  const verdicts = judge(current, recorded, ['services/a'])
  const status = Object.fromEntries(verdicts.map((v) => [v.stage, v.status]))

  it('compares rates exactly, not counts', () => {
    expect(status).toEqual({
      broken: 'error',
      down: 'dropped',
      empty: 'error',
      gone: 'missing',
      new: 'unrecorded',
      same: 'ok',
      up: 'improved',
    })
  })

  it('fails on a drop, an error, an empty or missing stage and an unrecorded one', () => {
    expect(verdicts.filter(isFailing).map((v) => v.stage)).toEqual([
      'broken',
      'down',
      'empty',
      'gone',
      'new',
    ])
  })

  it('judges only the modules in scope', () => {
    expect(judge(current, recorded, ['services/b'])).toEqual([])
  })

  it('records clean stages, keeps refused ones at their old rate and drops vanished ones', () => {
    const { baselines, refused } = nextBaselines(verdicts, false)
    expect(baselines['services/a']).toEqual({
      down: { passed: 9, total: 10 },
      new: { passed: 1, total: 1 },
      same: { passed: 9, total: 10 },
      up: { passed: 10, total: 10 },
    })
    expect(refused.map((v) => v.stage)).toEqual(['broken', 'down', 'empty'])
    expect(nextBaselines(verdicts, true).baselines['services/a']?.down).toEqual({
      passed: 8,
      total: 10,
    })
  })

  it('prints per module and stage, per stage, per module and the failures', () => {
    const report = formatReport(verdicts)
    expect(report).toContain('Per stage')
    expect(report).toContain('Per module')
    expect(report).toMatch(/services\/a\s+down\s+8\/10\s+80\.0%\s+9\/10 90\.0%\s+DROPPED/)
    expect(report).toContain('error: boom')
    expect(report).toContain('FAIL: 5 of 7')
  })
})
