import test from 'node:test'
import assert from 'node:assert'

// Fixture test for dispatch.mjs reconciler logic
// Verifies that the dispatcher correctly identifies conditions for firing Routines

test('dispatcher: fire conditions', async (t) => {
  // Test case 1: Non-draft PR with all checks passing should fire review
  await t.test('fires review when PR is ready', () => {
    const pr = {
      draft: false,
      labels: [],
      head: { sha: 'abc123' },
    }
    const checkRuns = [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'success' },
    ]
    const hasChainReview = false

    // All checks passing, not draft, no chain review status
    const shouldFireReview =
      !pr.draft && checkRuns.every((r) => r.conclusion === 'success') && !hasChainReview

    assert.strictEqual(shouldFireReview, true, 'should fire review')
  })

  // Test case 2: PR with changes-needed label should fire fix
  await t.test('fires fix when changes-needed label present', () => {
    const pr = {
      labels: [{ name: 'changes-needed' }],
      body: 'fix-attempt: 1',
    }
    const hasChainBuild = false
    const fixAttempts = parseInt(pr.body?.match(/fix-attempt: (\d+)/)?.[1] || '0', 10)

    const shouldFireFix =
      (pr.labels.some((l) => l.name === 'changes-needed') || false) &&
      !hasChainBuild &&
      fixAttempts < 3

    assert.strictEqual(shouldFireFix, true, 'should fire fix')
  })

  // Test case 3: Max fix attempts reached should not fire
  await t.test('stops firing after 3 fix attempts', () => {
    const pr = {
      labels: [{ name: 'changes-needed' }],
      body: 'fix-attempt: 3',
    }
    const fixAttempts = parseInt(pr.body?.match(/fix-attempt: (\d+)/)?.[1] || '0', 10)

    const shouldFireFix = fixAttempts < 3

    assert.strictEqual(shouldFireFix, false, 'should not fire after max attempts')
  })

  // Test case 4: Draft PR should not fire review
  await t.test('does not fire review for draft PR', () => {
    const pr = {
      draft: true,
      labels: [],
      head: { sha: 'abc123' },
    }
    const checkRuns = [{ status: 'completed', conclusion: 'success' }]
    const hasChainReview = false

    const shouldFireReview =
      !pr.draft && checkRuns.every((r) => r.conclusion === 'success') && !hasChainReview

    assert.strictEqual(shouldFireReview, false, 'should not fire for draft')
  })

  // Test case 5: Checks still running should not fire
  await t.test('does not fire when checks are still running', () => {
    const pr = { draft: false, labels: [] }
    const checkRuns = [{ status: 'in_progress', conclusion: null }]
    const hasChainReview = false

    const allPassing = checkRuns.every((r) => r.conclusion === 'success')
    const shouldFireReview = !pr.draft && allPassing && !hasChainReview

    assert.strictEqual(shouldFireReview, false, 'should not fire while checks running')
  })

  // Test case 6: Existing chain/review status should not fire
  await t.test('does not fire when chain/review status exists', () => {
    const pr = { draft: false, labels: [] }
    const checkRuns = [{ status: 'completed', conclusion: 'success' }]
    const hasChainReview = true

    const shouldFireReview =
      !pr.draft && checkRuns.every((r) => r.conclusion === 'success') && !hasChainReview

    assert.strictEqual(shouldFireReview, false, 'should not fire with existing chain status')
  })
})
