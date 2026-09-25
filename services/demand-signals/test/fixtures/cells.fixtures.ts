import { describe, expect, it } from 'vitest'
import { caseIds, runCase } from '../support/cases'

// Stage "cells": synthetic wants and wanted or swap adverts seeded into want-manager's,
// listing-ingest's, parts-record's, listing-assessment's and copy-advert's own tables on the real
// migrations in PGlite, one publish of a closed week, and the cells `v_cells` then shows: per
// centre and family, the shown counts and the suppressed flag.

describe('cells', () => {
  it.each(caseIds())(
    '%s',
    async (id) => {
      const { observed, expected } = await runCase(id)
      expect(observed).toEqual(expected)
    },
    60_000,
  )
})
