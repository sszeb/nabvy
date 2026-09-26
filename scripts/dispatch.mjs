import { execFileSync, execSync } from 'node:child_process'
import https from 'node:https'

import { parseReviewed, STATE_BRANCH } from './precheck.mjs'

const GITHUB_API = 'https://api.github.com'
const ROUTINE_API = 'https://api.anthropic.com/v1/claude_code/routines'

const CHAIN_REVIEW_CONTEXT = 'chain/review'
const CHAIN_FIX_CONTEXT = 'chain/fix'
const MAX_FIX_ATTEMPTS = 3
// A claim in reviewed.txt this fresh means a Reviewer run is likely mid-flight on the head: the
// reconciler backs off rather than firing a second one. Shorter than precheck.mjs's own
// STALE_CLAIM_MS (2h, which governs when the reviewer itself may re-claim a head that a crashed
// run left claimed) because this guard only needs to survive the gap until the reviewer's own
// claim or the chain/review status lands, not a whole dead run's timeout.
const REVIEWED_CLAIM_STALE_MS = 30 * 60 * 1000

const {
  GITHUB_TOKEN,
  REVIEW_FIRE_TOKEN,
  FIX_FIRE_TOKEN,
  REVIEW_ROUTINE_ID,
  FIX_ROUTINE_ID,
  CHAIN_LIVE,
  EVENT_NAME,
  WORKFLOW_RUN_HEAD_SHA,
} = process.env // convention-check: ignore no-process-env (CI script, not app config)

// Read reviewed.txt off the state branch (the reviewer's own claim/verdict memory,
// scripts/precheck.mjs), so the reconciler can skip a head the reviewer already has in hand.
// Best-effort: a fetch failure (network hiccup, branch briefly missing) falls back to an empty
// map, which never blocks a fire -- the chain/review status stays as the guard in that case.
function fetchReviewedText() {
  try {
    execFileSync(
      'git',
      ['fetch', '-q', 'origin', `+refs/heads/${STATE_BRANCH}:refs/remotes/origin/${STATE_BRANCH}`],
      {
        stdio: 'pipe',
      },
    )
    return execFileSync('git', ['show', `origin/${STATE_BRANCH}:reviewed.txt`], {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  } catch (err) {
    console.error('Could not read reviewed.txt from state branch:', err.message)
    return ''
  }
}

// Parse owner/repo from git remote
function getOwnerRepo() {
  const remote = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim()
  const match = remote.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(\.git)?$/)
  if (!match) throw new Error(`Could not parse GitHub URL: ${remote}`)
  return { owner: match[1], repo: match[2] }
}

function authHeaders() {
  return {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
  }
}

// Make HTTPS request
async function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      headers: {
        'User-Agent': 'Nabvy Dispatcher',
        ...(options.headers || {}),
      },
      ...options,
    }

    const req = https.request(url, reqOptions, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        })
      })
    })

    req.on('error', reject)
    if (options.body) {
      req.write(JSON.stringify(options.body))
    }
    req.end()
  })
}

// Fire a Routine with the given text.
async function fireRoutine(routineId, fireToken, text) {
  if (!fireToken || !routineId) {
    console.log('Skipping fire: missing token or routine ID')
    return null
  }

  try {
    const response = await httpsRequest(`${ROUTINE_API}/${routineId}/fire`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fireToken}`,
        'Content-Type': 'application/json',
      },
      body: { text },
    })

    console.log(`[FIRE] ${routineId}: ${response.status} - ${text}`)
    return response
  } catch (err) {
    console.error(`[FIRE ERROR] ${routineId}:`, err.message)
    return null
  }
}

// Get PR details from GitHub
async function getPRDetails(owner, repo, prNumber) {
  const response = await httpsRequest(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: authHeaders(),
  })

  if (response.status !== 200) {
    console.error(`Failed to get PR ${prNumber}: ${response.status}`)
    return null
  }

  return JSON.parse(response.body)
}

// Find the open PR (if any) associated with a commit sha. Used on the workflow_run path,
// where the triggering CI run carries a head sha/branch but no PR number: github.event.workflow_run
// only lists associated pull_requests for same-repo branches, so this looks it up via the API
// instead of trusting that array.
async function findOpenPRForSha(owner, repo, sha) {
  const response = await httpsRequest(`${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}/pulls`, {
    headers: authHeaders(),
  })

  if (response.status !== 200) {
    console.error(`Failed to look up PRs for sha ${sha}: ${response.status}`)
    return null
  }

  const prs = JSON.parse(response.body)
  const open = prs.find(
    (pr) => pr.state === 'open' && pr.head.repo.full_name === `${owner}/${repo}`,
  )
  return open ? open.number : null
}

// List every open PR's number. Used by the 30-minute backstop, which has no single sha/PR to
// react to and instead sweeps every open PR the same way the event-driven paths do.
async function listOpenPRNumbers(owner, repo) {
  const response = await httpsRequest(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
    { headers: authHeaders() },
  )

  if (response.status !== 200) {
    console.error(`Failed to list open PRs: ${response.status}`)
    return []
  }

  return JSON.parse(response.body)
    .filter((pr) => pr.head.repo.full_name === `${owner}/${repo}`)
    .map((pr) => pr.number)
}

// Check PR's commit status
async function getCommitStatus(owner, repo, sha) {
  const response = await httpsRequest(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}/status`,
    { headers: authHeaders() },
  )

  if (response.status !== 200) {
    return null
  }

  return JSON.parse(response.body)
}

// Write a commit status. Used as the duplicate-fire guard: a role is fired at most once per
// head sha, checked by reading this same status back in decideActions/getCommitStatus.
async function createCommitStatus(owner, repo, sha, context, description) {
  await httpsRequest(`${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: { state: 'success', context, description },
  })
}

// Get check runs for a commit
async function getCheckRuns(owner, repo, headSha) {
  const response = await httpsRequest(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${headSha}/check-runs`,
    { headers: authHeaders() },
  )

  if (response.status !== 200) {
    return []
  }

  const data = JSON.parse(response.body)
  return data.check_runs || []
}

// -- Pure decision logic (exported for tests; no I/O) --

export function allChecksPassing(checkRuns) {
  if (!checkRuns || checkRuns.length === 0) return false
  return checkRuns.every((run) => run.status === 'completed' && run.conclusion === 'success')
}

export function anyChecksFailing(checkRuns) {
  if (!checkRuns || checkRuns.length === 0) return false
  return checkRuns.some((run) => run.status === 'completed' && run.conclusion === 'failure')
}

export function parseFixAttempts(prBody) {
  return Number.parseInt(prBody?.match(/fix-attempt: (\d+)/)?.[1] ?? '0', 10)
}

// Second guard alongside the chain/review commit status: reviewed.txt (scripts/precheck.mjs) is
// the reviewer's own memory, written before the reconciler's status can exist for a fresh claim.
// A recorded verdict (approved/merged/changes) blocks forever -- that head already has an
// outcome. A claim blocks only while it is fresh; a stale one (the claiming run died) never
// arrived at a verdict, so the head is fireable again.
export function reviewedBlocksReview(reviewedMap, prNumber, headSha, nowMs) {
  const entry = reviewedMap.get(`${prNumber}@${headSha.slice(0, 7)}`)
  if (!entry) return false
  if (entry.status !== 'claimed') return true
  const age = nowMs - Date.parse(entry.at)
  return Number.isNaN(age) || age < REVIEWED_CLAIM_STALE_MS
}

export function decideActions({
  pr,
  checkRuns,
  hasChainReview,
  hasChainFix,
  reviewedBlocked = false,
}) {
  const allPassing = allChecksPassing(checkRuns)
  const anyFailing = anyChecksFailing(checkRuns)
  const fixAttempts = parseFixAttempts(pr.body)

  const shouldFireReview = pr.draft !== true && allPassing && !hasChainReview && !reviewedBlocked

  const needsFix = (pr.labels ?? []).some((label) => label.name === 'changes-needed') || anyFailing
  const shouldFireFix = needsFix && !hasChainFix && fixAttempts < MAX_FIX_ATTEMPTS

  return { shouldFireReview, shouldFireFix, fixAttempts }
}

// -- Orchestration (I/O) --

async function reconcilePR(owner, repo, prNumber, reviewedMap) {
  const pr = await getPRDetails(owner, repo, prNumber)
  if (!pr) {
    console.log(`Could not fetch PR #${prNumber}`)
    return
  }
  if (pr.state !== 'open') {
    console.log(`PR #${prNumber} is not open, skipping`)
    return
  }

  const headSha = pr.head.sha
  const sha7 = headSha.slice(0, 7)
  console.log(`PR #${prNumber}: draft=${pr.draft}, sha=${sha7}`)

  const status = await getCommitStatus(owner, repo, headSha)
  const hasChainReview = status?.statuses?.some((s) => s.context === CHAIN_REVIEW_CONTEXT) ?? false
  const hasChainFix = status?.statuses?.some((s) => s.context === CHAIN_FIX_CONTEXT) ?? false
  const checkRuns = await getCheckRuns(owner, repo, headSha)
  const reviewedBlocked = reviewedBlocksReview(reviewedMap, prNumber, headSha, Date.now())

  const { shouldFireReview, shouldFireFix, fixAttempts } = decideActions({
    pr,
    checkRuns,
    hasChainReview,
    hasChainFix,
    reviewedBlocked,
  })

  if (shouldFireReview) {
    console.log(`[REVIEW] PR #${prNumber} is ready for review`)
    await fireRoutine(
      REVIEW_ROUTINE_ID,
      REVIEW_FIRE_TOKEN,
      `PR #${prNumber}: ${pr.title}; head ${sha7}; CI green`,
    )
    await createCommitStatus(owner, repo, headSha, CHAIN_REVIEW_CONTEXT, 'Reviewer Routine fired')
  }

  if (shouldFireFix) {
    console.log(
      `[FIX] PR #${prNumber} needs fixes (attempt ${fixAttempts + 1}/${MAX_FIX_ATTEMPTS})`,
    )
    await fireRoutine(FIX_ROUTINE_ID, FIX_FIRE_TOKEN, `PR #${prNumber} sha=${headSha}`)
    await createCommitStatus(owner, repo, headSha, CHAIN_FIX_CONTEXT, 'Fixer Routine fired')
  } else if (fixAttempts >= MAX_FIX_ATTEMPTS) {
    console.log(`[HOLD] PR #${prNumber} reached max fix attempts, needs a human`)
  }
}

async function main() {
  if (CHAIN_LIVE === 'false') {
    console.log('CHAIN_LIVE is false, reconciler paused')
    return
  }

  const { owner, repo } = getOwnerRepo()
  console.log(`Dispatcher running on ${owner}/${repo}, event: ${EVENT_NAME}`)

  if (EVENT_NAME === 'workflow_run') {
    if (!WORKFLOW_RUN_HEAD_SHA) {
      console.log('No workflow_run head sha in env, nothing to do')
      return
    }
    const prNumber = await findOpenPRForSha(owner, repo, WORKFLOW_RUN_HEAD_SHA)
    if (!prNumber) {
      console.log(`No open PR found for sha ${WORKFLOW_RUN_HEAD_SHA.slice(0, 7)}, nothing to do`)
      return
    }
    const reviewedMap = parseReviewed(fetchReviewedText())
    await reconcilePR(owner, repo, prNumber, reviewedMap)
    return
  }

  if (EVENT_NAME === 'schedule') {
    const prNumbers = await listOpenPRNumbers(owner, repo)
    console.log(`Backstop sweep: ${prNumbers.length} open PR(s)`)
    const reviewedMap = parseReviewed(fetchReviewedText())
    for (const prNumber of prNumbers) {
      await reconcilePR(owner, repo, prNumber, reviewedMap)
    }
    return
  }

  if (EVENT_NAME === 'push') {
    console.log('[COORDINATOR] Main branch push detected')
    return
  }

  console.log(`Unhandled event ${EVENT_NAME}, nothing to do`)
}

// Only run when executed directly (`node scripts/dispatch.mjs`), not when the test file imports
// the pure functions above.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Dispatch failed:', err)
    process.exit(1)
  })
}
