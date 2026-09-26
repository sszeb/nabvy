#!/usr/bin/env node
// Cheap pre-check for fired Routine runs (task 0.20a-routine-files): decide in one call whether
// there is anything to do, before the run reads any docs.
// Usage:
//   node scripts/precheck.mjs coordinator [rootDir] [--main-sha=<sha>] [--pr-heads=<ls-remote output>]
//   node scripts/precheck.mjs reviewer [rootDir] [--open-heads=<ls-remote output>] [--reviewed-refs=<ls-remote output>]
//
// Real runs shell out to git; the --main-sha/--pr-heads/--open-heads/--reviewed-refs flags let
// precheck.test.mjs exercise both modes end to end without a network call or a real remote.
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

// "<sha>\trefs/pull/<n>/head" lines -> {"#<n>@<sha7>", ...}, the shape state.md's Fingerprint uses.
export function parsePrHeads(lsRemoteOutput) {
  const out = new Set()
  for (const line of lsRemoteOutput.split('\n')) {
    const m = /^([0-9a-f]{7,40})\s+refs\/pull\/(\d+)\/head$/.exec(line.trim())
    if (m) out.add(`#${m[2]}@${m[1].slice(0, 7)}`)
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
    attempt(() => run('git', ['ls-remote', 'origin', 'refs/pull/*/head'], rootDir), '')
  console.log(coordinatorQuiet(stateText, mainSha, parsePrHeads(lsRemote)) ? 'QUIET' : 'BUSY')
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

export function parseOpenPrHeads(lsRemoteOutput) {
  const out = new Map()
  for (const line of lsRemoteOutput.split('\n')) {
    const m = /^([0-9a-f]{7,40})\s+refs\/pull\/(\d+)\/head$/.exec(line.trim())
    if (m) out.set(Number(m[2]), m[1])
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
    attempt(() => run('git', ['ls-remote', 'origin', 'refs/pull/*/head'], rootDir), '')
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
