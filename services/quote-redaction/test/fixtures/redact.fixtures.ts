import { describe, expect, it } from 'vitest'
import { redact } from '../../src/index'
import { cases, nonZero } from '../cases'

// Stage `redact`: every shared case, one it() per case (fixtures/README.md, "Runner"). The
// same cases run against SQL in packages/db/tests/quote-redaction.test.sql.
describe('redact', () => {
  for (const c of cases) {
    it(c.id, () => {
      const result = redact(c.input)
      expect({ text: result.text, masked: nonZero(result.masked) }).toEqual({
        text: c.text,
        masked: c.masked,
      })
    })
  }
})
