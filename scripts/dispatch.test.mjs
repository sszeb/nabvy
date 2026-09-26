import assert from 'node:assert'
import test from 'node:test'

import { allChecksPassing, anyChecksFailing, decideActions, parseFixAttempts } from './dispatch.mjs'

// Fixture test for dispatch.mjs reconciler logic. Imports and exercises the shipped functions
// directly, so a regression in the real logic fails this test rather than a re-implemented copy.

test('allChecksPassing', () => {
  assert.strictEqual(allChecksPassing([]), false, 'no checks is not passing')
  assert.strictEqual(allChecksPassing([{ status: 'completed', conclusion: 'success' }]), true)
  assert.strictEqual(
    allChecksPassing([{ status: 'in_progress', conclusion: null }]),
    false,
    'a running check is not passing',
  )
  assert.strictEqual(
    allChecksPassing([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
    ]),
    false,
  )
})

test('anyChecksFailing', () => {
  assert.strictEqual(anyChecksFailing([]), false)
  assert.strictEqual(anyChecksFailing([{ status: 'completed', conclusion: 'failure' }]), true)
  assert.strictEqual(anyChecksFailing([{ status: 'completed', conclusion: 'success' }]), false)
})

test('parseFixAttempts', () => {
  assert.strictEqual(parseFixAttempts('fix-attempt: 2'), 2)
  assert.strictEqual(parseFixAttempts('no marker here'), 0)
  assert.strictEqual(parseFixAttempts(undefined), 0)
  // Regression: the count must be a number, not a string, or "attempt " + (fixAttempts + 1)
  // string-concatenates ("2" + 1 -> "21") instead of incrementing.
  assert.strictEqual(parseFixAttempts('fix-attempt: 2') + 1, 3)
})

test('decideActions: fires review when PR is ready', () => {
  const pr = { draft: false, labels: [], body: '', head: { sha: 'abc123' } }
  const checkRuns = [
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'success' },
  ]
  const result = decideActions({ pr, checkRuns, hasChainReview: false, hasChainFix: false })
  assert.strictEqual(result.shouldFireReview, true)
  assert.strictEqual(result.shouldFireFix, false)
})

test('decideActions: fires fix when changes-needed label present', () => {
  const pr = { draft: false, labels: [{ name: 'changes-needed' }], body: 'fix-attempt: 1' }
  const checkRuns = []
  const result = decideActions({ pr, checkRuns, hasChainReview: false, hasChainFix: false })
  assert.strictEqual(result.shouldFireFix, true)
  assert.strictEqual(result.fixAttempts, 1)
})

test('decideActions: fires fix when checks are failing, even without the label', () => {
  const pr = { draft: false, labels: [], body: '' }
  const checkRuns = [{ status: 'completed', conclusion: 'failure' }]
  const result = decideActions({ pr, checkRuns, hasChainReview: false, hasChainFix: false })
  assert.strictEqual(result.shouldFireFix, true)
})

test('decideActions: stops firing fix after 3 attempts', () => {
  const pr = { draft: false, labels: [{ name: 'changes-needed' }], body: 'fix-attempt: 3' }
  const result = decideActions({ pr, checkRuns: [], hasChainReview: false, hasChainFix: false })
  assert.strictEqual(result.shouldFireFix, false, 'should not fire after max attempts')
})

test('decideActions: does not fire review for a draft PR', () => {
  const pr = { draft: true, labels: [], body: '' }
  const checkRuns = [{ status: 'completed', conclusion: 'success' }]
  const result = decideActions({ pr, checkRuns, hasChainReview: false, hasChainFix: false })
  assert.strictEqual(result.shouldFireReview, false, 'should not fire for draft')
})

test('decideActions: does not fire review while checks are still running', () => {
  const pr = { draft: false, labels: [], body: '' }
  const checkRuns = [{ status: 'in_progress', conclusion: null }]
  const result = decideActions({ pr, checkRuns, hasChainReview: false, hasChainFix: false })
  assert.strictEqual(result.shouldFireReview, false, 'should not fire while checks running')
})

test('decideActions: does not re-fire review when chain/review status already exists', () => {
  const pr = { draft: false, labels: [], body: '' }
  const checkRuns = [{ status: 'completed', conclusion: 'success' }]
  const result = decideActions({ pr, checkRuns, hasChainReview: true, hasChainFix: false })
  assert.strictEqual(result.shouldFireReview, false, 'should not fire with existing chain status')
})

test('decideActions: does not re-fire fix when chain/fix status already exists', () => {
  const pr = { draft: false, labels: [{ name: 'changes-needed' }], body: 'fix-attempt: 0' }
  const result = decideActions({ pr, checkRuns: [], hasChainReview: false, hasChainFix: true })
  assert.strictEqual(
    result.shouldFireFix,
    false,
    'should not re-fire with existing chain/fix status',
  )
})
