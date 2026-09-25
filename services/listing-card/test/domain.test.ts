import { describe, expect, it } from 'vitest'
import * as domain from '../src/domain/index'

// Rule 16 of docs/design/modules/_rules.md asks every module for a domain test. listing-card has
// no pure logic to test here: it owns no tables and no thresholds (module card, "Owns: none"), and
// its one behaviour — the Facebook link, the redacted title, the suppression and unresolved-status
// filters, the stale-fallback flag — is entirely the SQL view's job, exercised end to end by
// packages/db/tests/listing-card.test.sql and by test/fixtures/card.fixtures.ts. This test only
// pins that `src/domain` stays empty on purpose, so a future PR does not wonder why the file is
// missing.

describe('listing-card domain', () => {
  it('has no pure logic: the view does the work (see the db test and the fixtures)', () => {
    expect(Object.keys(domain)).toEqual([])
  })
})
