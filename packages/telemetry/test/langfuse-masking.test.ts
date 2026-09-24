import { describe, expect, it } from 'vitest'
import { maskSensitiveData } from '../src/langfuse/masking'

describe('maskSensitiveData', () => {
  it('redacts seller-shaped keys and emails in a JSON-encoded object, as the SDK hands it over', () => {
    const data = JSON.stringify({
      listingId: 'listing-1',
      sellerId: 'seller-42',
      sellerName: 'Jo Bloggs',
      note: 'Contact me on jo@example.com or 07123 456789',
    })
    const masked = JSON.parse(maskSensitiveData({ data }) as string)
    expect(masked.listingId).toBe('listing-1')
    expect(masked.sellerId).toBe('[redacted]')
    expect(masked.sellerName).toBe('[redacted]')
    expect(masked.note).not.toContain('jo@example.com')
    expect(masked.note).not.toContain('07123 456789')
  })

  it('redacts a plain (non-JSON) string', () => {
    const masked = maskSensitiveData({ data: 'reach the seller at jo@example.com' })
    expect(masked).not.toContain('jo@example.com')
  })

  it('leaves values with nothing sensitive unchanged', () => {
    const data = JSON.stringify({ listingId: 'listing-1', tier: 'default' })
    expect(maskSensitiveData({ data })).toBe(data)
  })
})
