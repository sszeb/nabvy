#!/usr/bin/env node
// Cheap pre-check for fired Routine runs (task 0.20a-routine-files): decide in one call whether
// there is anything to do, before the run reads any docs.
// Usage:
//   node scripts/precheck.mjs coordinator [rootDir] [--main-sha=<sha>] [--pr-heads=<ls-remote output>]
//   node scripts/precheck.mjs reviewer [rootDir] [--open-heads=<ls-remote output>] [--reviewed-refs=<ls-remote output>]
// (--pr-heads and --open-heads take `git ls-remote origin 'refs/pull/*/head' 'refs/pull/*/merge'` output.)
//
// Real runs shell out to git; the --main-sha/--pr-heads/--open-heads/--reviewed-refs flags let
// precheck.test.mjs exercise both modes end to end without a network call or a real remote.
//
// GitHub keeps refs/pull/<n>/head for every PR ever opened, closed and merged ones included, so a
// head list alone is not the open-PR list. It removes refs/pull/<n>/merge when a PR closes, so both
// modes ask for heads and merge refs in one ls-remote and keep only open PRs (see openPrNumbers).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const attempt = (fn, fallback) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim()

// Parses `--flag=value` args after the mode and (optional) rootDir positional args.
function parseFlags(args) {
  const flags = {}
  const positional = []
  for (const arg of args) {
    const m = /^--([a-z-]+)=([\s\S]*)$/.exec(arg)
    if (m) flags[m[1]] = m[2]
    else positional.push(arg)
  }
  return { flags, positional }
}

// --- coordinator: QUIET when main + open-PR heads match state's Fingerprint and the three
// dispatcher/reviewer queues are empty. ---

export function parseFingerprint(stateText) {
  const m = /Fingerprint:\s*([0-9a-f]+);\s*([^;]*);\s*ledger\s+(\d+)/.exec(stateText)
  if (!m) return null
  const prs = new Set(
    m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  return { mainSha: m[1], prs, ledger: Number(m[3]) }
}

// True when no line between "## <heading>" and the next "## " (or end of file) is a bullet.
export function queueEmpty(stateText, heading) {
  const lines = stateText.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start === -1) return true
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break
    if (lines[i].trim().startsWith('-')) return false
  }
  return true
}

// The PR numbers to treat as open, from `git ls-remote origin 'refs/pull/*/head' 'refs/pull/*/merge'`:
// every PR with a merge ref, every number in `known` (the Fingerprint's PRs, so one that loses its
// merge ref to a conflict still counts), and every head numbered above all of those (a new PR that
// opened with a conflict has no merge ref yet). Output with no merge refs at all (an older caller or
// fixture) keeps every head, which errs towards BUSY.
export function openPrNumbers(lsRemoteOutput, known = []) {
  const heads = []
  const open = new Set(known)
  let sawMerge = false
  for (const line of lsRemoteOutput.split('\n')) {
    const m = /^[0-9a-f]{7,40}\s+refs\/pull\/(\d+)\/(head|merge)$/.exec(line.trim())
    if (!m) continue
    if (m[2] === 'merge') {
      sawMerge = true
      open.add(Number(m[1]))
    } else heads.push(Number(m[1]))
  }
  if (!sawMerge) return new Set(heads)
  const newest = Math.max(0, ...open)
  for (const n of heads) if (n > newest) open.add(n)
  return open
}

// "<sha>\trefs/pull/<n>/head" lines -> {"#<n>@<sha7>", ...}, the shape state.md's Fingerprint uses.
// With `open`, only those PR numbers are kept.
export function parsePrHeads(lsRemoteOutput, open) {
  const out = new Set()
  for (const line of lsRemoteOutput.split('\n')) {
    const m = /^([0-9a-f]{7,40})\s+refs\/pull\/(\d+)\/head$/.exec(line.trim())
    if (m && (!open || open.has(Number(m[2])))) out.add(`#${m[2]}@${m[1].slice(0, 7)}`)
  }
  return out
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))

export function coordinatorQuiet(stateText, mainSha, prHeadsSet) {
  const fp = parseFingerprint(stateText)
  if (!fp || fp.mainSha !== mainSha || !sameSet(fp.prs, prHeadsSet)) return false
  return (
    queueEmpty(stateText, 'Merged, migrations pending') &&
    queueEmpty(stateText, 'Sessions to start') &&
    queueEmpty(stateText, 'Messages to send')
  )
}

function coordinatorMain(rootDir, flags) {
  const stateText = readFileSync(join(rootDir, 'state.md'), 'utf8')
  const mainSha = flags['main-sha'] ?? run('git', ['rev-parse', '--short', 'origin/main'], rootDir)
  const lsRemote =
    flags['pr-heads'] ??
    attempt(
      () => run('git', ['ls-remote', 'origin', 'refs/pull/*/head', 'refs/pull/*/merge'], rootDir),
      '',
    )
  const known = [...(parseFingerprint(stateText)?.prs ?? [])].map((p) =>
    Number(/^#(\d+)@/.exec(p)?.[1]),
  )
  const heads = parsePrHeads(lsRemote, openPrNumbers(lsRemote, known))
  console.log(coordinatorQuiet(stateText, mainSha, heads) ? 'QUIET' : 'BUSY')
}

// --- reviewer: list open PRs whose head has no matching refs/reviewed/pr-<n>. ---

export function parseReviewedRefs(lsRemoteOutput) {
  const out = new Map()
  for (const line of lsRemoteOutput.split('\n')) {
    const m = /^([0-9a-f]{7,40})\s+refs\/reviewed\/pr-(\d+)$/.exec(line.trim())
    if (m) out.set(Number(m[2]), m[1])
  }
  return out
}

// Heads of open PRs only (openPrNumbers), keyed by PR number.
export function parseOpenPrHeads(lsRemoteOutput) {
  // Extract all head PR numbers to seed `known` - any PR with a head ref
  // should be considered open, even if it lacks a merge ref (conflict case).
  const allHeads = []
  for (const line of lsRemoteOutput.split('\n')) {
    const m = /^[0-9a-f]{7,40}\s+refs\/pull\/(\d+)\/head$/.exec(line.trim())
    if (m) allHeads.push(Number(m[1]))
  }
  const open = openPrNumbers(lsRemoteOutput, allHeads)
  const out = new Map()
  for (const line of lsRemoteOutput.split('\n')) {
    const m = /^([0-9a-f]{7,40})\s+refs\/pull\/(\d+)\/head$/.exec(line.trim())
    if (m && open.has(Number(m[2]))) out.set(Number(m[2]), m[1])
  }
  return out
}

// prHeads/reviewedRefs: Map<prNumber, sha>. A PR is unreviewed when it has no reviewed ref, or
// the reviewed ref does not prefix-match its current head (either side of a git remote may hand
// back a short or a full sha).
export function unreviewedPrs(prHeads, reviewedRefs) {
  const out = []
  for (const [n, sha] of prHeads) {
    const reviewed = reviewedRefs.get(n)
    if (!reviewed || !(sha.startsWith(reviewed) || reviewed.startsWith(sha))) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

function reviewerMain(rootDir, flags) {
  const lsOpen =
    flags['open-heads'] ??
    attempt(
      () => run('git', ['ls-remote', 'origin', 'refs/pull/*/head', 'refs/pull/*/merge'], rootDir),
      '',
    )
  const lsReviewed =
    flags['reviewed-refs'] ??
    attempt(() => run('git', ['ls-remote', 'origin', 'refs/reviewed/pr-*'], rootDir), '')
  const candidates = unreviewedPrs(parseOpenPrHeads(lsOpen), parseReviewedRefs(lsReviewed))
  console.log(candidates.length === 0 ? 'QUIET' : candidates.map((n) => `#${n}`).join(' '))
}

function main() {
  const [mode, ...rest] = process.argv.slice(2)
  const { flags, positional } = parseFlags(rest)
  const rootDir = positional[0] ?? process.cwd()
  if (mode === 'coordinator') coordinatorMain(rootDir, flags)
  else if (mode === 'reviewer') reviewerMain(rootDir, flags)
  else {
    console.error('usage: node scripts/precheck.mjs coordinator|reviewer [rootDir]')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
