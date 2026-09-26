import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  coordinatorQuiet,
  parseFingerprint,
  parseOpenPrHeads,
  parsePrHeads,
  parseReviewedRefs,
  queueEmpty,
  unreviewedPrs,
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

test('parseReviewedRefs and parseOpenPrHeads read refs/reviewed and refs/pull lines', () => {
  const reviewed = parseReviewedRefs('aaaa111\trefs/reviewed/pr-10\nbbbb222\trefs/reviewed/pr-11\n')
  assert.deepEqual(
    [...reviewed],
    [
      [10, 'aaaa111'],
      [11, 'bbbb222'],
    ],
  )
  const open = parseOpenPrHeads('aaaa111\trefs/pull/10/head\ncccc333\trefs/pull/12/head\n')
  assert.deepEqual(
    [...open],
    [
      [10, 'aaaa111'],
      [12, 'cccc333'],
    ],
  )
})

test('unreviewedPrs: a PR with no reviewed ref, or a moved head, is unreviewed', () => {
  const prHeads = new Map([
    [10, 'aaaa111'], // reviewed at the same sha
    [11, 'zzzz999'], // head moved since it was reviewed
    [12, 'cccc333'], // never reviewed
  ])
  const reviewedRefs = new Map([
    [10, 'aaaa111'],
    [11, 'bbbb222'],
  ])
  assert.deepEqual(unreviewedPrs(prHeads, reviewedRefs), [11, 12])
})

test('CLI coordinator mode: prints QUIET when everything matches', () => {
  const dir = withState(QUIET_STATE)
  const { code, stdout } = runCli('coordinator', dir, {
    'main-sha': 'abc1234',
    'pr-heads': '54dee1e\trefs/pull/102/head\n93bd4e7\trefs/pull/101/head',
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'QUIET')
})

test('CLI coordinator mode: prints BUSY when a queue is non-empty', () => {
  const dir = withState(BUSY_STATE)
  const { code, stdout } = runCli('coordinator', dir, {
    'main-sha': 'abc1234',
    'pr-heads': '54dee1e\trefs/pull/102/head\n93bd4e7\trefs/pull/101/head',
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'BUSY')
})

test('CLI coordinator mode: prints BUSY when the main sha has moved', () => {
  const dir = withState(QUIET_STATE)
  const { code, stdout } = runCli('coordinator', dir, {
    'main-sha': 'def5678',
    'pr-heads': '54dee1e\trefs/pull/102/head\n93bd4e7\trefs/pull/101/head',
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'BUSY')
})

test('CLI reviewer mode: prints QUIET when every open PR has a matching reviewed ref', () => {
  const dir = withState(QUIET_STATE)
  const { code, stdout } = runCli('reviewer', dir, {
    'open-heads': 'aaaa111\trefs/pull/10/head',
    'reviewed-refs': 'aaaa111\trefs/reviewed/pr-10',
  })
  assert.equal(code, 0)
  assert.equal(stdout, 'QUIET')
})

test('CLI reviewer mode: lists PR numbers with no matching reviewed ref, lowest first', () => {
  const dir = withState(QUIET_STATE)
  const { code, stdout } = runCli('reviewer', dir, {
    'open-heads': 'aaaa111\trefs/pull/12/head\ncccc333\trefs/pull/10/head',
    'reviewed-refs': '',
  })
  assert.equal(code, 0)
  assert.equal(stdout, '#10 #12')
})

test('CLI: an unknown mode fails with a usage message', () => {
  const dir = withState(QUIET_STATE)
  const { code, stderr } = runCli('bogus', dir)
  assert.equal(code, 1)
  assert.match(stderr, /usage: node scripts\/precheck\.mjs/)
})
