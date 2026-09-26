#!/usr/bin/env node
// Cheap pre-check for fired Routine runs (task 0.20a-routine-files): decide in one call whether
// there is anything to do, before the run reads any docs.
// Usage:
//   node scripts/precheck.mjs coordinator [rootDir] [--main-sha=<sha>] [--pr-heads=<ls-remote output>] [--state=<text>]
//   node scripts/precheck.mjs reviewer [rootDir] [--open-heads=<ls-remote output>] [--reviewed=<text>] [--state=<text>] [--now=<iso>]
//   node scripts/precheck.mjs claim <pr> <head> [rootDir]
//   node scripts/precheck.mjs record <pr> <head> approved|merged|changes [rootDir]
// (--pr-heads and --open-heads take `git ls-remote origin 'refs/pull/*/head' 'refs/pull/*/merge'` output;
// --reviewed and --state stand in for reviewed.txt and state.md, which both modes otherwise read
// from the state branch.)
//
// Real runs shell out to git; the flags let precheck.test.mjs exercise the modes end to end
// without a network call. claim and record push to the state branch (tests use a local bare repo).
//
// GitHub keeps refs/pull/<n>/head for every PR ever opened, closed and merged ones included, so a
// head list alone is not the open-PR list. It removes refs/pull/<n>/merge when a PR closes, so both
// modes ask for heads and merge refs in one ls-remote and keep only open PRs (see openPrNumbers).
import { execFileSync } from 'node:child_process'

const attempt = (fn, fallback) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()

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
  if (flags.state === undefined) fetchState(rootDir)
  const stateText = flags.state ?? showState(rootDir, STATE_REF, 'state.md')
  const mainSha = flags['main-sha'] ?? run('git', ['rev-parse', '--short', 'origin/main'], rootDir)
  const lsRemote =
    flags['pr-heads'] ??
    attempt(
      () => run('git', ['ls-remote', 'origin', 'refs/pull/*/head', 'refs/pull/*/merge'], rootDir),
      '',
    )
  const heads = parsePrHeads(lsRemote, openPrNumbers(lsRemote, fingerprintPrs(stateText)))
  console.log(coordinatorQuiet(stateText, mainSha, heads) ? 'QUIET' : 'BUSY')
}

// --- reviewer: open PRs whose head has no line in reviewed.txt (to review), and approved heads
// not yet merged (to merge). reviewed.txt and state.md live on the state branch; git refuses
// pushes outside refs/heads here (HTTP 403 on refs/reviewed/*), so the reviewer's memory is a
// file on a branch. Lines: "#<n> <sha7> claimed|approved|merged|changes <UTC time>". ---

export const STATE_BRANCH = 'claude/coordinator-state'
const STATE_REF = `refs/remotes/origin/${STATE_BRANCH}`
const STATUSES = ['claimed', 'approved', 'merged', 'changes']
// A claim with no later line for 2 h is from a run that died: the head is reviewable again.
export const STALE_CLAIM_MS = 2 * 60 * 60 * 1000

// reviewed.txt -> Map<"<n>@<sha7>", {status, at}>, the last line per head winning.
export function parseReviewed(text) {
  const out = new Map()
  for (const line of text.split('\n')) {
    const m = /^#(\d+)\s+([0-9a-f]{7,40})\s+([a-z]+)(?:\s+(\S+))?$/.exec(line.trim())
    if (m && STATUSES.includes(m[3])) {
      out.set(`${m[1]}@${m[2].slice(0, 7)}`, { status: m[3], at: m[4] ?? '' })
    }
  }
  return out
}

// A head can be claimed when it has no line, or only a stale claim (an unreadable time is stale).
export function claimable(entry, nowMs) {
  if (!entry) return true
  return entry.status === 'claimed' && !(nowMs - Date.parse(entry.at) < STALE_CLAIM_MS)
}

// Heads of open PRs only (openPrNumbers), keyed by PR number. `known` is the Fingerprint's PR
// numbers, so an open PR that lost its merge ref to a conflict is still listed.
export function parseOpenPrHeads(lsRemoteOutput, known = []) {
  const open = openPrNumbers(lsRemoteOutput, known)
  const out = new Map()
  for (const line of lsRemoteOutput.split('\n')) {
    const m = /^([0-9a-f]{7,40})\s+refs\/pull\/(\d+)\/head$/.exec(line.trim())
    if (m && open.has(Number(m[2]))) out.set(Number(m[2]), m[1])
  }
  return out
}

// prHeads: Map<prNumber, sha>. review: heads that are claimable; merge: heads whose last line is
// `approved` (approved while CI ran; the backstop merges them once CI is green). Lowest first.
export function reviewerCandidates(prHeads, reviewed, nowMs) {
  const review = []
  const merge = []
  for (const [n, sha] of prHeads) {
    const entry = reviewed.get(`${n}@${sha.slice(0, 7)}`)
    if (claimable(entry, nowMs)) review.push(n)
    else if (entry.status === 'approved') merge.push(n)
  }
  const byNumber = (a, b) => a - b
  return { review: review.sort(byNumber), merge: merge.sort(byNumber) }
}

const fetchState = (rootDir) =>
  run('git', ['fetch', '-q', 'origin', `+refs/heads/${STATE_BRANCH}:${STATE_REF}`], rootDir)
const showState = (rootDir, rev, file) =>
  attempt(() => run('git', ['show', `${rev}:${file}`], rootDir), '')
const fingerprintPrs = (stateText) =>
  [...(parseFingerprint(stateText)?.prs ?? [])].map((p) => Number(/^#(\d+)@/.exec(p)?.[1]))
const nowFrom = (flags) => (flags.now ? Date.parse(flags.now) : Date.now())

function reviewerMain(rootDir, flags) {
  if (flags.reviewed === undefined || flags.state === undefined) fetchState(rootDir)
  const reviewed = flags.reviewed ?? showState(rootDir, STATE_REF, 'reviewed.txt')
  const stateText = flags.state ?? showState(rootDir, STATE_REF, 'state.md')
  const lsOpen =
    flags['open-heads'] ??
    run('git', ['ls-remote', 'origin', 'refs/pull/*/head', 'refs/pull/*/merge'], rootDir)
  const heads = parseOpenPrHeads(lsOpen, fingerprintPrs(stateText))
  const { review, merge } = reviewerCandidates(heads, parseReviewed(reviewed), nowFrom(flags))
  const list = (label, prs) => (prs.length ? [`${label} ${prs.map((n) => `#${n}`).join(' ')}`] : [])
  const lines = [...list('merge', merge), ...list('review', review)]
  console.log(lines.length ? lines.join('\n') : 'QUIET')
}

// Appends "#<n> <sha7> <status> <time>" to reviewed.txt on the state branch as one commit on top
// of the latest remote head, without a worktree, and pushes it fast-forward. A rejected push
// (another run wrote first) re-fetches and tries again. A claim of a head that is not claimable
// prints TAKEN. A push refused while the branch has not moved (no permission) prints UNCLAIMED
// or UNRECORDED, and the reviewer falls back to the head's reviews on GitHub.
export function writeReviewed(rootDir, n, sha, status, nowMs) {
  const git = (args, input) =>
    execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', input, stdio: 'pipe' }).trim()
  const sha7 = sha.slice(0, 7)
  const done = status === 'claimed' ? 'CLAIMED' : 'RECORDED'
  const failed = status === 'claimed' ? 'UNCLAIMED' : 'UNRECORDED'
  let parent = ''
  for (let tries = 0; tries < 5; tries++) {
    fetchState(rootDir)
    const latest = git(['rev-parse', STATE_REF])
    if (latest === parent) return failed
    parent = latest
    const text = showState(rootDir, parent, 'reviewed.txt')
    if (status === 'claimed' && !claimable(parseReviewed(text).get(`${n}@${sha7}`), nowMs)) {
      return 'TAKEN'
    }
    const at = new Date(nowMs).toISOString().slice(0, 16)
    const blob = git(
      ['hash-object', '-w', '--stdin'],
      `${text ? `${text}\n` : ''}#${n} ${sha7} ${status} ${at}Z\n`,
    )
    const entries = git(['ls-tree', parent])
      .split('\n')
      .filter((line) => line && !line.endsWith('\treviewed.txt'))
    const tree = git(
      ['mktree'],
      `${[...entries, `100644 blob ${blob}\treviewed.txt`].join('\n')}\n`,
    )
    const commit = git([
      'commit-tree',
      tree,
      '-p',
      parent,
      '-m',
      `reviewed: #${n} ${sha7} ${status}`,
    ])
    const push = () => {
      git(['push', '-q', 'origin', `${commit}:refs/heads/${STATE_BRANCH}`])
      return true
    }
    if (attempt(push, false)) return done
  }
  return failed
}

function writeMain(mode, positional, flags) {
  const [n, sha, ...rest] = positional
  const status = mode === 'claim' ? 'claimed' : rest.shift()
  const rootDir = rest[0] ?? process.cwd()
  const okStatus = mode === 'claim' || ['approved', 'merged', 'changes'].includes(status)
  if (!/^\d+$/.test(n ?? '') || !/^[0-9a-f]{7,40}$/.test(sha ?? '') || !okStatus) {
    console.error(
      'usage: node scripts/precheck.mjs claim <pr> <head> [rootDir] | record <pr> <head> approved|merged|changes [rootDir]',
    )
    process.exit(1)
  }
  console.log(writeReviewed(rootDir, Number(n), sha, status, nowFrom(flags)))
}

function main() {
  const [mode, ...rest] = process.argv.slice(2)
  const { flags, positional } = parseFlags(rest)
  if (mode === 'claim' || mode === 'record') return writeMain(mode, positional, flags)
  const rootDir = positional[0] ?? process.cwd()
  if (mode === 'coordinator') coordinatorMain(rootDir, flags)
  else if (mode === 'reviewer') {
    try {
      reviewerMain(rootDir, flags)
    } catch (err) {
      console.log(`ERROR ${String(err.message ?? err).split('\n')[0]}`)
      process.exit(2)
    }
  } else {
    console.error('usage: node scripts/precheck.mjs coordinator|reviewer|claim|record ...')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
