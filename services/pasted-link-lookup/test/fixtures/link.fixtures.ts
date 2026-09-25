import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMarketplaceLink } from '../../src/domain'

// Stage "link": every link shape a user may paste, one case per folder under cases/ whose
// input.json has "stage": "link" (item URL forms, share links, malformed and non-Facebook links;
// module card, "Tests and fixtures"). Synthetic: built from the link shape the card names and the
// 17-digit ID form of the recorded run; no listing content is read.

const CASES = new URL('./cases/', import.meta.url)
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
const cases = readdirSync(CASES)
  .sort()
  .filter((id) => read(new URL(`${id}/input.json`, CASES)).stage === 'link')

describe('link', () => {
  for (const id of cases) {
    it(id, () => {
      const input = read(new URL(`${id}/input.json`, CASES)) as { url: string }
      const expected = read(new URL(`${id}/expected.json`, CASES))
      const parsed = parseMarketplaceLink(input.url)
      expect(parsed.ok ? { ok: true, sourceListingId: parsed.sourceListingId } : parsed).toEqual(
        expected,
      )
    })
  }
})
