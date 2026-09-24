// Pure logic of the fixture runner: tally case results per module and stage, compare them with the
// module's previous recorded run, and print the report. No I/O here.

/** What one suite file produced: its case counts and why cases failed. */
export interface SuiteRun {
  module: string
  stage: string
  file: string
  passed: number
  failed: number
  skipped: number
  failures: string[]
  /** The file failed to load or collect, or an error escaped the tests. */
  errors: string[]
}

export interface Tally {
  passed: number
  total: number
}

export interface StageRun extends Tally {
  failures: string[]
  errors: string[]
}

/** module path → stage → tally. */
export type Tallies = Record<string, Record<string, Tally>>
export type StageRuns = Record<string, Record<string, StageRun>>

export type Status = 'ok' | 'improved' | 'dropped' | 'unrecorded' | 'missing' | 'error'

export interface Verdict {
  module: string
  stage: string
  status: Status
  current: StageRun | null
  recorded: Tally | null
}

/** Sums suite files into one run per module and stage. Skipped cases do not count. */
export const tallyRuns = (runs: SuiteRun[]): StageRuns => {
  const out: StageRuns = {}
  for (const run of runs) {
    out[run.module] ??= {}
    const stages = out[run.module] as Record<string, StageRun>
    stages[run.stage] ??= { passed: 0, total: 0, failures: [], errors: [] }
    const stage = stages[run.stage] as StageRun
    stage.passed += run.passed
    stage.total += run.passed + run.failed
    stage.failures.push(...run.failures)
    stage.errors.push(...run.errors)
  }
  return out
}

/** Compares a rate a/b with c/d exactly, without floating point. */
const compareRates = (a: Tally, b: Tally): number => a.passed * b.total - b.passed * a.total

/**
 * One verdict per stage run now or recorded before, for the modules in scope. A stage fails when
 * it errored, has no cases, its rate is below the recorded one, it has no recorded run, or a
 * recorded stage no longer runs.
 */
export const judge = (current: StageRuns, recorded: Tallies, modules: string[]): Verdict[] => {
  const verdicts: Verdict[] = []
  for (const module of [...modules].sort()) {
    const now = current[module] ?? {}
    const before = recorded[module] ?? {}
    const stages = [...new Set([...Object.keys(now), ...Object.keys(before)])].sort()
    for (const stage of stages) {
      const run = now[stage] ?? null
      const rec = before[stage] ?? null
      let status: Status
      if (!run) status = 'missing'
      else if (run.errors.length > 0 || run.total === 0) status = 'error'
      else if (!rec) status = 'unrecorded'
      else {
        const diff = compareRates(run, rec)
        status = diff < 0 ? 'dropped' : diff > 0 ? 'improved' : 'ok'
      }
      verdicts.push({ module, stage, status, current: run, recorded: rec })
    }
  }
  return verdicts
}

export const FAILING: ReadonlySet<Status> = new Set(['dropped', 'unrecorded', 'missing', 'error'])

export const isFailing = (verdict: Verdict): boolean => FAILING.has(verdict.status)

/**
 * The baselines to write when recording: every stage that ran cleanly, per module. A stage whose
 * rate dropped is kept at its recorded value unless the drop is accepted; errored stages are never
 * recorded; stages that no longer run are removed.
 */
export const nextBaselines = (
  verdicts: Verdict[],
  acceptDrop: boolean,
): { baselines: Tallies; refused: Verdict[] } => {
  const baselines: Tallies = {}
  const refused: Verdict[] = []
  for (const verdict of verdicts) {
    baselines[verdict.module] ??= {}
    const stages = baselines[verdict.module] as Record<string, Tally>
    const { current, recorded } = verdict
    if (verdict.status === 'missing') continue
    if (verdict.status === 'error' || (verdict.status === 'dropped' && !acceptDrop)) {
      refused.push(verdict)
      if (recorded) stages[verdict.stage] = recorded
      continue
    }
    if (current) stages[verdict.stage] = { passed: current.passed, total: current.total }
  }
  return { baselines, refused }
}

const percent = (tally: Tally): string =>
  tally.total === 0 ? '   –  ' : `${((100 * tally.passed) / tally.total).toFixed(1).padStart(5)}%`

const fraction = (tally: Tally): string => `${tally.passed}/${tally.total}`

const sumTallies = (tallies: Tally[]): Tally =>
  tallies.reduce((sum, t) => ({ passed: sum.passed + t.passed, total: sum.total + t.total }), {
    passed: 0,
    total: 0,
  })

const table = (rows: string[][]): string[] => {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((row) => row[i]?.length ?? 0))) ?? []
  return rows.map((row) =>
    row
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd(),
  )
}

const STATUS_TEXT: Record<Status, string> = {
  ok: 'ok',
  improved: 'improved (record it)',
  dropped: 'DROPPED below the recorded run',
  unrecorded: 'NOT RECORDED (run with --record)',
  missing: 'MISSING (recorded, no longer runs)',
  error: 'ERROR',
}

/** The printed report: module × stage, then per stage, then per module, then failures. */
export const formatReport = (verdicts: Verdict[], maxFailures = 10): string => {
  const lines: string[] = ['Fixture pass rates', '']
  const ran = verdicts.filter((v) => v.current)

  lines.push(
    ...table([
      ['module', 'stage', 'passed', 'rate', 'recorded', 'status'],
      ...verdicts.map((v) => [
        v.module,
        v.stage,
        v.current ? fraction(v.current) : '–',
        v.current ? percent(v.current) : '',
        v.recorded ? `${fraction(v.recorded)} ${percent(v.recorded).trim()}` : '–',
        STATUS_TEXT[v.status],
      ]),
    ]),
  )

  const group = (key: (v: Verdict) => string): string[][] => {
    const groups = new Map<string, Tally[]>()
    for (const v of ran) groups.set(key(v), [...(groups.get(key(v)) ?? []), v.current as Tally])
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, tallies]) => {
        const sum = sumTallies(tallies)
        return [name, fraction(sum), percent(sum)]
      })
  }
  lines.push('', 'Per stage', ...table([['stage', 'passed', 'rate'], ...group((v) => v.stage)]))
  lines.push('', 'Per module', ...table([['module', 'passed', 'rate'], ...group((v) => v.module)]))

  const troubled = ran.filter((v) => v.current?.failures.length || v.current?.errors.length)
  for (const v of troubled) {
    const { failures, errors } = v.current as StageRun
    lines.push('', `${v.module} · ${v.stage}`)
    for (const error of errors) lines.push(`  error: ${error}`)
    for (const failure of failures.slice(0, maxFailures)) lines.push(`  failed: ${failure}`)
    if (failures.length > maxFailures) lines.push(`  … and ${failures.length - maxFailures} more`)
  }

  const failing = verdicts.filter(isFailing)
  lines.push(
    '',
    failing.length === 0
      ? `PASS: ${verdicts.length} stage run(s), none below its recorded run.`
      : `FAIL: ${failing.length} of ${verdicts.length} stage run(s) failed the check.`,
  )
  return lines.join('\n')
}
