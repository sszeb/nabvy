import { Source } from '@nabvy/contracts'
import { describe, expect, it } from 'vitest'
import * as data from '@/data'
import { suspicionText } from '@/lib/labels'

/**
 * The rules the UI must follow (docs/decisions.md, Precedence and "Actor data kept in full"),
 * checked on everything the data-access layer returns that vitest can reach with no database or
 * session: `listExampleDeals()` (the design page's fixtures) and the account/admin/marketing
 * fixtures that have not been wired to a real module yet.
 *
 * `listDeals`, `getDeal`, `listHunts`, `getHunt` and `getAccount` now call real oRPC procedures
 * (task L1: `docs/backlog.md` "Milestone L") that need a signed-in session and a database
 * connection, neither of which this suite has, so they moved out of this file. Playwright covers
 * them end to end (`test/screens/l1.spec.ts`); the module's own fixture tests
 * (`services/want-manager/test`, `services/pickup-location/test`, …) cover their own rules.
 * Recorded in docs/questions/L1-web.md.
 */

async function everything(): Promise<unknown[]> {
  const examples = await data.listExampleDeals()
  return [
    examples,
    await data.listChannels(),
    await data.listAlertDeliveries(),
    await data.getPreferences(),
    await data.getDashboardSummary(),
    await data.getAdminOverview(),
    await data.listReviewQueue(),
  ]
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(key, child)
      walk(child, visit)
    }
  }
}

const sellerKey = /seller|profile|avatar|owner|vendor|user_?id|userId|picture/i
const locationKey =
  /^(lat|lng|lon|latitude|longitude|coords?|coordinates|postcode|street|address)$/i

describe('user-facing data', () => {
  it('carries no seller field at any depth', async () => {
    const found: string[] = []
    walk(await everything(), (key) => {
      if (sellerKey.test(key)) found.push(key)
    })
    expect(found).toEqual([])
  })

  it('carries no location finer than a town or a postcode district', async () => {
    const found: string[] = []
    walk(await everything(), (key, value) => {
      if (locationKey.test(key)) found.push(key)
      if (key === 'postcodeDistrict' && typeof value === 'string') {
        expect(value).toMatch(/^[A-Z]{1,2}[0-9][0-9A-Z]?$/)
      }
    })
    expect(found).toEqual([])
  })

  it('carries no listing free text', async () => {
    const found: string[] = []
    const { deals, irish } = await data.listExampleDeals()
    walk([deals, irish], (key) => {
      if (/^description$/i.test(key)) found.push(key)
    })
    expect(found).toEqual([])
  })

  it('keeps price history within one listing ID', async () => {
    const { deals, irish } = await data.listExampleDeals()
    for (const deal of [...deals, irish]) {
      for (const change of deal.priceChanges) {
        expect(Object.keys(change).sort()).toEqual(['ask', 'at'])
        expect(change.ask.currency).toBe(deal.listing.ask.currency)
      }
      const last = deal.priceChanges.at(-1)
      if (last) expect(last.ask.amountMinor).toBe(deal.listing.ask.amountMinor)
      // No history from before this listing existed: that would be the relist pattern.
      const listedAt = Date.parse(deal.listing.freshness.listedAt)
      const times = deal.priceChanges.map((change) => Date.parse(change.at))
      for (const time of times) expect(time).toBeGreaterThanOrEqual(listedAt)
      expect(times).toEqual([...times].sort((a, b) => a - b))
    }
  })

  it('compares asks only within their own currency group', async () => {
    const { deals, irish } = await data.listExampleDeals()
    for (const deal of [...deals, irish]) {
      expect(deal.position?.currency).toBe(deal.listing.ask.currency)
      expect(deal.position?.askMinor).toBe(deal.listing.ask.amountMinor)
    }
  })

  it('words every label as a suspicion, with evidence and a rule', async () => {
    const { deals, irish } = await data.listExampleDeals()
    for (const deal of [...deals, irish]) {
      for (const suspicion of deal.suspicions) {
        expect(suspicionText(suspicion)).toMatch(/^Suspected [a-z ]+: /)
        expect(suspicion.evidence.length).toBeGreaterThan(0)
        expect(suspicion.rule).not.toBe('')
      }
    }
  })

  it('carries no number that reads as a score', async () => {
    const found: string[] = []
    walk(await everything(), (key) => {
      if (/score/i.test(key)) found.push(key)
    })
    expect(found).toEqual([])
  })

  it('names a contracts source and links only to placeholder hosts', async () => {
    const { deals, irish } = await data.listExampleDeals()
    for (const deal of [...deals, irish]) {
      expect(Source.safeParse(deal.listing.source).success).toBe(true)
      expect(new URL(deal.listing.listingUrl).hostname).toMatch(/\.invalid$/)
    }
  })

  it('never ties evidence to other listings by place', async () => {
    const { deals, irish } = await data.listExampleDeals()
    for (const deal of [...deals, irish]) {
      for (const suspicion of deal.suspicions) {
        for (const item of suspicion.evidence) expect(item.label).not.toMatch(/town|place|area/i)
      }
    }
  })

  it('follows the copy rules in every string', async () => {
    walk(await everything(), (_key, value) => {
      if (typeof value !== 'string') return
      expect(value).not.toContain('!')
      expect(value).not.toMatch(/\b(worth|fair value|relisted|seen before|hurry|last chance)\b/i)
    })
  })
})
