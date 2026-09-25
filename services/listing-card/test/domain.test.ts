import { describe, expect, it } from 'vitest'
import { chunk } from '../src/domain/index'

// Rule 16 of docs/design/modules/_rules.md: pure rules and boundary values. listing-card's only
// pure logic is chunk(), used by cardsFor to read listing IDs in batches of at most 500 (rule 9).
// Everything else — the Facebook link, the redacted title, the suppression and unresolved-status
// filters, the stale-fallback flag — is the SQL view's job, exercised end to end by
// packages/db/tests/listing-card.test.sql and by test/fixtures/card.fixtures.ts.

describe('chunk', () => {
  it('splits into batches of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('one batch when everything fits', () => {
    expect(chunk([1, 2, 3], 500)).toEqual([[1, 2, 3]])
  })

  it('empty input makes no batches', () => {
    expect(chunk([], 500)).toEqual([])
  })

  it('a batch exactly the size stays whole', () => {
    expect(chunk([1, 2], 2)).toEqual([[1, 2]])
  })
})
