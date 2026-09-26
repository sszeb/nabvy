import { execSync } from 'node:child_process'
import https from 'node:https'

const GITHUB_API = 'https://api.github.com'
const ROUTINE_API = 'https://api.anthropic.com/v1/claude_code/routines'

const { GITHUB_TOKEN, REVIEW_FIRE_TOKEN, FIX_FIRE_TOKEN, CHAIN_LIVE, PR_NUMBER, EVENT_NAME } =
  process.env

// Parse owner/repo from git remote
function getOwnerRepo() {
  const remote = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim()
  const match = remote.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(\.git)?$/)
  if (!match) throw new Error(`Could not parse GitHub URL: ${remote}`)
  return { owner: match[1], repo: match[2] }
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

// Fire a Routine
async function fireRoutine(routineId, fireToken, prNumber, headSha) {
  if (!fireToken || !routineId) {
    console.log(`Skipping fire: missing token or routine ID`)
    return null
  }

  const text = `PR #${prNumber} sha=${headSha}`
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
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (response.status !== 200) {
    console.error(`Failed to get PR ${prNumber}: ${response.status}`)
    return null
  }

  return JSON.parse(response.body)
}

// Check PR's commit status
async function getCommitStatus(owner, repo, sha) {
  const response = await httpsRequest(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}/status`,
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    },
  )

  if (response.status !== 200) {
    return null
  }

  return JSON.parse(response.body)
}

// Get check runs for a commit
async function getCheckRuns(owner, repo, headSha) {
  const response = await httpsRequest(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${headSha}/check-runs`,
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    },
  )

  if (response.status !== 200) {
    return []
  }

  const data = JSON.parse(response.body)
  return data.check_runs || []
}

// Check if all checks are passing
function allChecksPassing(checkRuns) {
  if (!checkRuns || checkRuns.length === 0) return false
  return checkRuns.every((run) => run.status === 'completed' && run.conclusion === 'success')
}

// Check if any checks are failing
function anyChecksFailing(checkRuns) {
  if (!checkRuns || checkRuns.length === 0) return false
  return checkRuns.some((run) => run.status === 'completed' && run.conclusion === 'failure')
}

// Post or update chain status comment
async function updateChainStatus(owner, repo, prNumber, status) {
  const body = `<!-- CHAIN_STATUS -->\n**Chain Status**: ${status}`

  // Try to find existing comment
  const commentsResponse = await httpsRequest(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    },
  )

  if (commentsResponse.status === 200) {
    const comments = JSON.parse(commentsResponse.body)
    const existing = comments.find((c) => c.body.includes('<!-- CHAIN_STATUS -->'))

    if (existing) {
      // Update existing comment
      await httpsRequest(`${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: { body },
      })
      return
    }
  }

  // Create new comment
  await httpsRequest(`${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: { body },
  })
}

// Main dispatch logic
async function main() {
  if (CHAIN_LIVE === 'false') {
    console.log('CHAIN_LIVE is false, reconciler paused')
    return
  }

  const { owner, repo } = getOwnerRepo()
  console.log(`Dispatcher running on ${owner}/${repo}, event: ${EVENT_NAME}`)

  // Handle PR-specific logic
  if (PR_NUMBER) {
    const pr = await getPRDetails(owner, repo, PR_NUMBER)
    if (!pr) {
      console.log(`Could not fetch PR #${PR_NUMBER}`)
      return
    }

    const headSha = pr.head.sha
    const isDraft = pr.draft

    console.log(`PR #${PR_NUMBER}: draft=${isDraft}, sha=${headSha.slice(0, 7)}`)

    // Check commit status for chain statuses
    const status = await getCommitStatus(owner, repo, headSha)
    const hasChainReview = status?.statuses?.some((s) => s.context === 'chain/review')
    const hasChainBuild = status?.statuses?.some((s) => s.context === 'chain/build')

    // Get check runs
    const checkRuns = await getCheckRuns(owner, repo, headSha)
    const allPassing = allChecksPassing(checkRuns)
    const anyFailing = anyChecksFailing(checkRuns)

    // Determine if we should fire
    let shouldFireReview = false
    let shouldFireFix = false

    if (!isDraft && allPassing && !hasChainReview) {
      // Non-draft PR with all checks passing and no pending review
      shouldFireReview = true
      console.log(`[REVIEW] PR is ready for review`)
    }

    if ((pr.labels?.some?.((l) => l.name === 'changes-needed') || anyFailing) && !hasChainBuild) {
      // PR has changes-needed label or failing checks
      const fixAttempts = pr.body?.match(/fix-attempt: (\d+)/)?.[1] || 0
      if (fixAttempts < 3) {
        shouldFireFix = true
        console.log(`[FIX] PR needs fixes (attempt ${fixAttempts + 1}/3)`)
      } else {
        console.log(`[HOLD] Max fix attempts reached, marking needs-human`)
        // Could set needs-human status here
      }
    }

    if (shouldFireReview) {
      const routineId = process.env.REVIEW_ROUTINE_ID
      await fireRoutine(routineId, REVIEW_FIRE_TOKEN, PR_NUMBER, headSha)
      await updateChainStatus(owner, repo, PR_NUMBER, `review-fired`)
    }

    if (shouldFireFix) {
      const routineId = process.env.FIX_ROUTINE_ID
      await fireRoutine(routineId, FIX_FIRE_TOKEN, PR_NUMBER, headSha)
      await updateChainStatus(owner, repo, PR_NUMBER, `fix-fired`)
    }
  }

  // Handle main branch pushes (coordinator trigger)
  if (EVENT_NAME === 'push') {
    console.log(`[COORDINATOR] Main branch push detected`)
    // Coordinator fires on merge with migrations; this is handled by the PR Closed trigger
  }

  console.log('Dispatch complete')
}

main().catch((err) => {
  console.error('Dispatch failed:', err)
  process.exit(1)
})
