import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  claimable,
  coordinatorQuiet,
  openPrNumbers,
  parseFingerprint,
  parseOpenPrHeads,
  parsePrHeads,
  parseReviewed,
  queueEmpty,
  reviewerCandidates,
} from './precheck.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const script = join(here, 'precheck.mjs')

const QUIET_STATE = `# Coordinator state

Fingerprint: abc1234; #102@54dee1e,#101@93bd4e7; ledger 91.

## Merged, migrations pending

## Sessions to start

## Messages to send
`

const BUSY_STATE = `# Coordinator state

Fingerprint: abc1234; #102@54dee1e,#101@93bd4e7; ledger 91.

## Merged, migrations pending
- PR #85 merged: packages/db/migrations/attribution/20260924_attribution.sql

## Sessions to start

## Messages to send
`

function runCli(mode, rootDir, flags = {}) {
  const flagArgs = Object.entries(flags).map(([k, v]) => `--${k}=${v}`)
  const result = spawnSync('node', [script, mode, rootDir, ...flagArgs], { encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr }
}

function withState(text) {
  const dir = mkdtempSync(join(tmpdir(), 'precheck-'))
  writeFileSync(join(dir, 'state.md'), text)
  return dir
}

test('parseFingerprint reads the main sha, PR heads and ledger count', () => {
  const fp = parseFingerprint(QUIET_STATE)
  assert.equal(fp.mainSha, 'abc1234')
  assert.equal(fp.ledger, 91)
  assert.deepEqual([...fp.prs].sort(), ['#101@93bd4e7', '#102@54dee1e'])
})

test('queueEmpty is true for a heading with no bullets, false once one appears', () => {
  assert.equal(queueEmpty(QUIET_STATE, 'Sessions to start'), true)
  assert.equal(queueEmpty(BUSY_STATE, 'Merged, migrations pending'), false)
})

test('queueEmpty treats a missing heading as empty', () => {
  assert.equal(queueEmpty(QUIET_STATE, 'Nonexistent heading'), true)
})

test('parsePrHeads shortens full shas to match the Fingerprint format', () => {
  const out = parsePrHeads(
    '54dee1eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/pull/102/head\n' +
      '93bd4e7bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/pull/101/head\n',
  )
  assert.deepEqual([...out].sort(), ['#101@93bd4e7', '#102@54dee1e'])
})

test('coordinatorQuiet: true when main sha, PR heads and all three queues match/are empty', () => {
  const heads = new Set(['#102@54dee1e', '#101@93bd4e7'])
  assert.equal(coordinatorQuiet(QUIET_STATE, 'abc1234', heads), true)
})

test('coordinatorQuiet: false on a main sha mismatch', () => {
  const heads = new Set(['#102@54dee1e', '#101@93bd4e7'])
  assert.equal(coordinatorQuiet(QUIET_STATE, 'def5678', heads), false)
})

test('coordinatorQuiet: false when a PR head has moved', () => {
  const heads = new Set(['#102@0000000', '#101@93bd4e7'])
  assert.equal(coordinatorQuiet(QUIET_STATE, 'abc1234', heads), false)
})

test('coordinatorQuiet: false when a queue is non-empty even if the fingerprint matches', () => {
  const heads = new Set(['#102@54dee1e', '#101@93bd4e7'])
  assert.equal(coordinatorQuiet(BUSY_STATE, 'abc1234', heads), false)
})

test('CLI coordinator mode: prints QUIET when everything matches', () => {
  const dir = withState(QUIET_STATE)
  const { code, stdout } = runCli('coordinator', dir, {
    state: QUIET_STATE,
    'main-sha': 'abc1234',
    'pr-heads': '54dee1e\trefs/pull/102/head\n93bd4e7\trefs/pull/101/head',
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'QUIET')
})

test('CLI coordinator mode: prints BUSY when a queue is non-empty', () => {
  const dir = withState(BUSY_STATE)
  const { code, stdout } = runCli('coordinator', dir, {
    state: BUSY_STATE,
    'main-sha': 'abc1234',
    'pr-heads': '54dee1e\trefs/pull/102/head\n93bd4e7\trefs/pull/101/head',
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'BUSY')
})

test('CLI coordinator mode: prints BUSY when the main sha has moved', () => {
  const dir = withState(QUIET_STATE)
  const { code, stdout } = runCli('coordinator', dir, {
    state: QUIET_STATE,
    'main-sha': 'def5678',
    'pr-heads': '54dee1e\trefs/pull/102/head\n93bd4e7\trefs/pull/101/head',
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'BUSY')
})

// GitHub keeps refs/pull/<n>/head for closed and merged PRs; only open PRs keep refs/pull/<n>/merge.
const LIVE_REFS = [
  '1111111\trefs/pull/5/head', // closed long ago: no merge ref
  '93bd4e7\trefs/pull/101/head',
  '9999999\trefs/pull/101/merge',
  '54dee1e\trefs/pull/102/head',
  '8888888\trefs/pull/102/merge',
].join('\n')

test('openPrNumbers keeps PRs with a merge ref, known PRs and newer heads; drops closed PRs', () => {
  assert.deepEqual([...openPrNumbers(LIVE_REFS)].sort(), [101, 102])
  // #5 is known (in the Fingerprint): kept even without a merge ref.
  assert.deepEqual(
    [...openPrNumbers(LIVE_REFS, [5])].sort((a, b) => a - b),
    [5, 101, 102],
  )
  // #103 opened with a conflict (no merge ref yet) but is newer than every open PR: kept.
  const withNew = `${LIVE_REFS}\n7777777\trefs/pull/103/head`
  assert.deepEqual([...openPrNumbers(withNew)].sort(), [101, 102, 103])
  // No merge refs at all (older caller): every head counts, which errs towards BUSY.
  assert.deepEqual([...openPrNumbers('aaaa111\trefs/pull/10/head')], [10])
})

test('CLI coordinator mode: closed PRs in ls-remote output do not break QUIET', () => {
  const dir = withState(QUIET_STATE)
  const { code, stdout } = runCli('coordinator', dir, {
    state: QUIET_STATE,
    'main-sha': 'abc1234',
    'pr-heads': LIVE_REFS,
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'QUIET')
})

test('CLI coordinator mode: a new PR with no merge ref yet makes the run BUSY', () => {
  const dir = withState(QUIET_STATE)
  const { stdout } = runCli('coordinator', dir, {
    state: QUIET_STATE,
    'main-sha': 'abc1234',
    'pr-heads': `${LIVE_REFS}\n7777777\trefs/pull/103/head`,
  })
  assert.equal(stdout, 'BUSY')
})

test('CLI: an unknown mode fails with a usage message', () => {
  const dir = withState(QUIET_STATE)
  const { code, stderr } = runCli('bogus', dir)
  assert.equal(code, 1)
  assert.match(stderr, /usage: node scripts\/precheck\.mjs/)
})

// --- reviewer mode: reviewed.txt on the state branch ---

const T0 = '2026-09-26T12:00:00Z'
const HOUR = 60 * 60 * 1000

test('parseReviewed keeps the last line per head and ignores unknown lines', () => {
  const reviewed = parseReviewed(
    [
      '#113 f0f27cf claimed 2026-09-26T12:00Z',
      '#113 f0f27cfa2b claimed 2026-09-26T12:01Z', // longer sha: same head
      '#113 f0f27cf approved 2026-09-26T12:05Z',
      '#109 ba09f25 changes',
      '#109 ba09f25 lgtm 2026-09-26T12:06Z', // unknown status: ignored
      'not a line',
    ].join('\n'),
  )
  assert.deepEqual(
    [...reviewed],
    [
      ['113@f0f27cf', { status: 'approved', at: '2026-09-26T12:05Z' }],
      ['109@ba09f25', { status: 'changes', at: '' }],
    ],
  )
})

test('claimable: no line, a released or stale or unreadable claim; never a verdict', () => {
  const now = Date.parse(T0)
  assert.equal(claimable(undefined, now), true)
  assert.equal(claimable({ status: 'claimed', at: '2026-09-26T11:45Z' }, now), false)
  assert.equal(claimable({ status: 'claimed', at: '2026-09-26T11:29Z' }, now), true)
  assert.equal(claimable({ status: 'claimed', at: '' }, now), true)
  assert.equal(claimable({ status: 'released', at: '2026-09-26T11:59Z' }, now), true)
  for (const status of ['approved', 'merged', 'changes']) {
    assert.equal(claimable({ status, at: '2026-09-26T09:00Z' }, now), false)
  }
})

test('parseOpenPrHeads drops closed PRs and keeps a known open PR that lost its merge ref', () => {
  const refs = `${LIVE_REFS}\n90abd12\trefs/pull/90/head` // #90: open, conflicted, no merge ref
  assert.deepEqual([...parseOpenPrHeads(refs).keys()].sort(), [101, 102])
  assert.deepEqual(
    [...parseOpenPrHeads(refs, [90, 101, 102]).keys()].sort((a, b) => a - b),
    [90, 101, 102],
  )
})

test('reviewerCandidates: unreviewed and stale-claimed heads to review, approved heads to merge', () => {
  const heads = new Map([
    [10, 'aaaa111'], // approved while CI ran
    [11, 'bbbb222'], // head moved since its review
    [12, 'cccc333'], // claimed ten minutes ago
    [13, 'dddd444'], // claim from a run that died
    [14, 'eeee555'], // merged (ref not yet gone)
    [15, 'ffff666'], // changes needed on this head
  ])
  const reviewed = parseReviewed(
    [
      '#10 aaaa111 approved 2026-09-26T08:00Z',
      '#11 0000000 changes 2026-09-26T08:00Z',
      '#12 cccc333 claimed 2026-09-26T11:50Z',
      '#13 dddd444 claimed 2026-09-26T08:00Z',
      '#14 eeee555 merged 2026-09-26T08:00Z',
      '#15 ffff666 changes 2026-09-26T08:00Z',
    ].join('\n'),
  )
  assert.deepEqual(reviewerCandidates(heads, reviewed, Date.parse(T0)), {
    review: [11, 13],
    merge: [10],
  })
})

test('CLI reviewer mode: prints QUIET when every open head has a verdict', () => {
  const { code, stdout } = runCli('reviewer', withState(QUIET_STATE), {
    'open-heads': LIVE_REFS,
    reviewed: '#101 93bd4e7 changes 2026-09-26T08:00Z\n#102 54dee1e merged 2026-09-26T08:00Z',
    state: QUIET_STATE,
    now: T0,
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'QUIET')
})

test('CLI reviewer mode: lists merge then review candidates; never closed PRs', () => {
  const { code, stdout } = runCli('reviewer', withState(QUIET_STATE), {
    'open-heads': `${LIVE_REFS}\n90abd12\trefs/pull/90/head`, // #5 closed; #90 open, conflicted
    reviewed: '#101 93bd4e7 approved 2026-09-26T08:00Z',
    state: 'Fingerprint: abc1234; #90@90abd12,#101@93bd4e7,#102@54dee1e; ledger 91.',
    now: T0,
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'merge #101\nreview #90 #102')
})

test('CLI reviewer mode: prints ERROR when the open-PR list cannot be read', () => {
  const { code, stdout } = runCli('reviewer', withState(QUIET_STATE), {
    reviewed: '',
    state: QUIET_STATE,
  })
  assert.equal(code, 2)
  assert.match(stdout, /^ERROR /)
})

// claim and record against a local bare repository standing in for origin.
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()

const initRepo = (dir, ...args) => {
  git(dir, 'init', '-q', ...args)
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'user.email', 'test@example.com')
}

function stateRemote() {
  const origin = mkdtempSync(join(tmpdir(), 'precheck-origin-'))
  git(origin, 'init', '-q', '--bare')
  const writer = mkdtempSync(join(tmpdir(), 'precheck-writer-'))
  initRepo(writer)
  writeFileSync(join(writer, 'state.md'), QUIET_STATE)
  mkdirSync(join(writer, 'briefs'))
  writeFileSync(join(writer, 'briefs', 'x.md'), 'brief\n')
  git(writer, 'add', '-A')
  git(writer, 'commit', '-qm', 'state')
  git(writer, 'remote', 'add', 'origin', origin)
  git(writer, 'push', '-q', 'origin', 'HEAD:refs/heads/claude/coordinator-state')
  const reviewer = mkdtempSync(join(tmpdir(), 'precheck-reviewer-'))
  initRepo(reviewer)
  git(reviewer, 'remote', 'add', 'origin', origin)
  return { origin, writer, reviewer }
}

function runWrite(args, now = T0) {
  const result = spawnSync('node', [script, ...args, `--now=${now}`], { encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr }
}

const remoteFile = (origin, file) => git(origin, 'show', `claude/coordinator-state:${file}`)

test('CLI claim and record: one claim per head, verdicts appended, other files kept', () => {
  const { origin, writer, reviewer } = stateRemote()
  assert.equal(runWrite(['claim', '113', 'f0f27cf57d07', reviewer]).stdout, 'CLAIMED')
  assert.equal(runWrite(['claim', '113', 'f0f27cf', reviewer]).stdout, 'TAKEN')
  // Another run writes state.md in between; the next write builds on it.
  git(writer, 'pull', '-q', 'origin', 'claude/coordinator-state')
  writeFileSync(join(writer, 'state.md'), BUSY_STATE)
  git(writer, 'commit', '-qam', 'state: busy')
  git(writer, 'push', '-q', 'origin', 'HEAD:refs/heads/claude/coordinator-state')
  assert.equal(runWrite(['record', '113', 'f0f27cf', 'approved', reviewer]).stdout, 'RECORDED')
  assert.equal(
    remoteFile(origin, 'reviewed.txt'),
    '#113 f0f27cf claimed 2026-09-26T12:00Z\n#113 f0f27cf approved 2026-09-26T12:00Z',
  )
  assert.equal(`${remoteFile(origin, 'state.md')}\n`, BUSY_STATE)
  assert.equal(remoteFile(origin, 'briefs/x.md'), 'brief')
  // An approved head is never claimed again; a claim left by a dead run expires after 30 min.
  assert.equal(runWrite(['claim', '113', 'f0f27cf', reviewer]).stdout, 'TAKEN')
  assert.equal(runWrite(['claim', '114', 'abcdef1', reviewer]).stdout, 'CLAIMED')
  const later = new Date(Date.parse(T0) + 3 * HOUR).toISOString()
  assert.equal(runWrite(['claim', '114', 'abcdef1', reviewer], later).stdout, 'CLAIMED')
})

test('CLI claim: a push the remote refuses prints UNCLAIMED', () => {
  const { origin, reviewer } = stateRemote()
  const hook = join(origin, 'hooks', 'pre-receive')
  writeFileSync(hook, '#!/bin/sh\nexit 1\n')
  chmodSync(hook, 0o755)
  assert.equal(runWrite(['claim', '113', 'f0f27cf', reviewer]).stdout, 'UNCLAIMED')
  assert.equal(runWrite(['record', '113', 'f0f27cf', 'merged', reviewer]).stdout, 'UNRECORDED')
})

test('CLI claim and record: bad arguments fail with a usage message', () => {
  assert.equal(runWrite(['claim', 'x', 'f0f27cf']).code, 1)
  assert.equal(runWrite(['record', '113', 'f0f27cf', 'lgtm']).code, 1)
  assert.match(runWrite(['record', '113', 'zz']).stderr, /usage: node scripts\/precheck\.mjs claim/)
})

test('CLI coordinator mode: reads state.md from the state branch, not the checkout', () => {
  const { reviewer } = stateRemote()
  // No state.md in the run's own checkout: the state branch's QUIET_STATE decides.
  const { code, stdout } = runCli('coordinator', reviewer, {
    'main-sha': 'abc1234',
    'pr-heads': '54dee1e\trefs/pull/102/head\n93bd4e7\trefs/pull/101/head',
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'QUIET')
})

test('CLI record released: frees a claimed head for the next run', () => {
  const { reviewer } = stateRemote()
  assert.equal(runWrite(['claim', '121', 'abc1234', reviewer]).stdout, 'CLAIMED')
  assert.equal(runWrite(['claim', '121', 'abc1234', reviewer]).stdout, 'TAKEN')
  assert.equal(runWrite(['record', '121', 'abc1234', 'released', reviewer]).stdout, 'RECORDED')
  assert.equal(runWrite(['claim', '121', 'abc1234', reviewer]).stdout, 'CLAIMED')
})
