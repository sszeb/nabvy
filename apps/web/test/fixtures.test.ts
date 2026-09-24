import { describe, expect, it } from 'vitest'
import * as data from '@/data'
import { suspicionText } from '@/lib/labels'

/**
 * The rules the UI must follow (docs/decisions.md, Precedence and "Actor data kept in full"),
 * checked on everything the data-access layer returns. When procedures replace the fixtures,
 * the same checks run on procedure output.
 */

async function everything(): Promise<unknown[]> {
  const deals = await data.listDeals()
  const detailed = await Promise.all(deals.map((deal) => data.getDeal(deal.id)))
  const examples = await data.listExampleDeals()
  return [
    deals,
    detailed,
    examples,
    await data.listHunts(),
    await data.listChannels(),
    await data.listAlertDeliveries(),
    await data.getAccount(),
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
    for (const deal of await data.listDeals()) {
      for (const change of deal.priceChanges) {
        expect(Object.keys(change).sort()).toEqual(['ask', 'at'])
        expect(change.ask.currency).toBe(deal.listing.ask.currency)
      }
      const last = deal.priceChanges.at(-1)
      if (last) expect(last.ask.amountMinor).toBe(deal.listing.ask.amountMinor)
    }
  })

  it('compares asks only within their own currency group', async () => {
    const { deals, irish } = await data.listExampleDeals()
    for (const deal of [...deals, irish]) {
      expect(deal.position.currency).toBe(deal.listing.ask.currency)
      expect(deal.position.askMinor).toBe(deal.listing.ask.amountMinor)
    }
  })

  it('words every label as a suspicion, with evidence and a rule', async () => {
    for (const deal of await data.listDeals()) {
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

  it('uses Facebook as the only source', async () => {
    for (const deal of await data.listDeals()) {
      expect(deal.listing.source).toBe('facebook')
      expect(deal.listing.listingUrl).toMatch(
        /^https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/$/,
      )
    }
  })

  it('follows the copy rules in every string', async () => {
    walk(await everything(), (_key, value) => {
      if (typeof value !== 'string') return
      expect(value).not.toContain('!')
      expect(value).not.toMatch(/\b(worth|fair value|relisted|seen before|hurry|last chance)\b/i)
      expect(value).not.toMatch(/\b(ebay|cex|gumtree)\b/i)
    })
  })
})

describe('data access', () => {
  it('filters deals by text, hunt and low asks', async () => {
    expect((await data.listDeals({ q: 'rtx 3070' })).length).toBeGreaterThan(0)
    for (const deal of await data.listDeals({ huntId: 'h-2' })) expect(deal.huntId).toBe('h-2')
    for (const deal of await data.listDeals({ lowAsksOnly: true })) {
      expect(deal.position.comparableCount).toBeGreaterThanOrEqual(10)
      expect(deal.position.percentile).toBeLessThanOrEqual(25)
    }
    expect(await data.listDeals({ q: 'no such thing anywhere' })).toEqual([])
  })

  it('returns deals newest first', async () => {
    const found = (await data.listDeals()).map((deal) => Date.parse(deal.listing.freshness.foundAt))
    expect(found).toEqual([...found].sort((a, b) => b - a))
  })
})
