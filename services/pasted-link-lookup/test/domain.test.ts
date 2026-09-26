import { describe, expect, it } from 'vitest'
import { canonicalLink, chunk, parseMarketplaceLink, readyKey } from '../src/domain'

// Pure rules, including the boundary values (rule 16 of docs/design/modules/_rules.md): the
// listing ID's length, the URL length, and every refusal reason.

const accepted = (url: string) => {
  const parsed = parseMarketplaceLink(url)
  return parsed.ok ? parsed.sourceListingId : `refused:${parsed.reason}`
}

describe('parseMarketplaceLink', () => {
  it('keeps the digits as text, including leading zeros and 17-digit IDs', () => {
    expect(accepted('https://www.facebook.com/marketplace/item/01234567890123456/')).toBe(
      '01234567890123456',
    )
    expect(accepted('https://www.facebook.com/marketplace/item/12345678901234567/')).toBe(
      '12345678901234567',
    )
  })

  it('accepts 30 digits and refuses 31', () => {
    expect(accepted(`https://www.facebook.com/marketplace/item/${'9'.repeat(30)}/`)).toBe(
      '9'.repeat(30),
    )
    expect(accepted(`https://www.facebook.com/marketplace/item/${'9'.repeat(31)}/`)).toBe(
      'refused:not_an_item_link',
    )
  })

  it('accepts the hosts, schemes and decorations users paste', () => {
    for (const url of [
      'facebook.com/marketplace/item/123',
      'http://m.facebook.com/marketplace/item/123/',
      'HTTPS://WWW.FACEBOOK.COM/marketplace/item/123/',
      'https://web.facebook.com/marketplace/item/123/?ref=share&mibextid=abc',
      'https://www.facebook.com/marketplace/item/123/#fragment',
      '  https://www.facebook.com/marketplace/item/123/  ',
    ]) {
      expect(accepted(url), url).toBe('123')
    }
  })

  it('refuses anything that is not a Marketplace item link', () => {
    expect(accepted('https://www.facebook.com/share/p/abc123/')).toBe('refused:not_an_item_link')
    expect(accepted('https://www.facebook.com/marketplace/search?query=rtx')).toBe(
      'refused:not_an_item_link',
    )
    expect(accepted('https://www.facebook.com/marketplace/item/abc/')).toBe(
      'refused:not_an_item_link',
    )
    expect(accepted('https://www.facebook.com/marketplace/item/123/extra')).toBe(
      'refused:not_an_item_link',
    )
    expect(accepted('https://www.facebook.com/groups/1/posts/2/')).toBe('refused:not_an_item_link')
  })

  it('refuses other hosts, including redirectors and short links', () => {
    for (const url of [
      'https://www.gumtree.com/p/item/123',
      'https://fb.com/marketplace/item/123/',
      'https://fb.me/abc',
      'https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.facebook.com%2Fmarketplace%2Fitem%2F123',
      'https://facebook.com.evil.example/marketplace/item/123/',
      'https://evilfacebook.com/marketplace/item/123/',
    ]) {
      expect(accepted(url), url).toBe('refused:not_facebook')
    }
  })

  it('refuses malformed input: empty, spaces, other schemes, credentials, ports, too long', () => {
    expect(accepted('')).toBe('refused:malformed')
    expect(accepted('   ')).toBe('refused:malformed')
    expect(accepted('https://www.facebook.com/marketplace/item/1 23/')).toBe('refused:malformed')
    expect(accepted('ftp://www.facebook.com/marketplace/item/123/')).toBe('refused:malformed')
    expect(accepted('javascript:alert(1)')).toBe('refused:malformed')
    expect(accepted('https://user:pw@www.facebook.com/marketplace/item/123/')).toBe(
      'refused:malformed',
    )
    expect(accepted('https://www.facebook.com:8443/marketplace/item/123/')).toBe(
      'refused:malformed',
    )
    const long = `https://www.facebook.com/marketplace/item/123/?x=${'a'.repeat(2048)}`
    expect(accepted(long)).toBe('refused:malformed')
  })
})

describe('canonicalLink', () => {
  it('matches the link app.v_listing_card shows, character for character', () => {
    expect(canonicalLink('facebook', '123')).toBe('https://www.facebook.com/marketplace/item/123/')
  })
})

describe('readyKey', () => {
  it('is the same for the same set in any order, and differs for another set', () => {
    const a = readyKey(['b', 'a'])
    expect(a).toBe(readyKey(['a', 'b']))
    expect(a).toMatch(/^pasted-link-lookup\.ready:[0-9a-f]{32}$/)
    expect(a).not.toBe(readyKey(['a']))
  })
})

describe('chunk', () => {
  it('splits into batches of at most size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 2)).toEqual([])
  })
})
