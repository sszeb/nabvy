// Pure logic of the pasted-link-lookup module: link parsing, the canonical link, event keys and
// batching. No I/O. Listing text and user input never choose URLs or runs
// (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:186-188): the only thing taken from a pasted
// link is the digits of its listing ID, and the only link ever built from them is the canonical
// one below, which is never fetched by this module.
import { createHash } from 'node:crypto'
import { PASTED_LINK_LOOKUP_MAX_URL_LENGTH } from '@nabvy/contracts/modules/pasted-link-lookup'

/** Why a pasted link was refused. Values are for tests and fixtures, never wording for users. */
export type LinkRefusal = 'malformed' | 'not_facebook' | 'not_an_item_link'

export type ParsedLink =
  | { ok: true; source: 'facebook'; sourceListingId: string }
  | { ok: false; reason: LinkRefusal }

/**
 * Facebook hosts a Marketplace item link may carry. Anything else, including the `l.facebook.com`
 * redirector, `fb.com`, `fb.me` and share links, is refused: the module card accepts only
 * `facebook.com/marketplace/item/<id>/`, and a share link's target is unknown without a fetch.
 */
const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'mbasic.facebook.com',
  'touch.facebook.com',
])

/** The one path shape accepted. The ID is 1-30 digits (details-queue's own limit). */
const ITEM_PATH = /^\/marketplace\/item\/(\d{1,30})\/?$/

/**
 * Takes the listing ID from a pasted Marketplace item link. Accepts `http` or `https`, a missing
 * scheme, any Facebook host above in any case, a trailing slash or none, and any query string or
 * fragment (tracking parameters are common and ignored). Refuses everything else. The ID is
 * returned as the exact digits pasted, as text, never parsed into a number (a recorded ID has 17
 * digits, past the safe-integer range).
 */
export function parseMarketplaceLink(raw: string): ParsedLink {
  const text = raw.trim()
  if (text.length === 0 || text.length > PASTED_LINK_LOOKUP_MAX_URL_LENGTH) {
    return { ok: false, reason: 'malformed' }
  }
  if (/\s/.test(text)) return { ok: false, reason: 'malformed' }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'malformed' }
  }
  if (url.username !== '' || url.password !== '' || url.port !== '') {
    return { ok: false, reason: 'malformed' }
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!FACEBOOK_HOSTS.has(host)) return { ok: false, reason: 'not_facebook' }
  const match = ITEM_PATH.exec(url.pathname)
  if (!match?.[1]) return { ok: false, reason: 'not_an_item_link' }
  return { ok: true, source: 'facebook', sourceListingId: match[1] }
}

/**
 * The link `app.v_listing_card` shows for a Facebook listing, character for character
 * (packages/db/migrations/listing-card/*_access.sql, `app.listing_card()`): the module looks a
 * request's listing up by this value. Never fetched.
 */
export function canonicalLink(source: 'facebook', sourceListingId: string): string {
  return `https://www.${source}.com/marketplace/item/${sourceListingId}/`
}

/**
 * A ready event's key: the exact set of request IDs it carries (rule 8 of docs/design/modules/
 * _rules.md: the natural IDs; a request becomes ready once, so the set is its version). A replay
 * of the same settle finds the requests already ready and publishes nothing.
 */
export function readyKey(requestIds: readonly string[]): string {
  const digest = createHash('sha256')
    .update([...requestIds].sort().join(','))
    .digest('hex')
    .slice(0, 32)
  return `pasted-link-lookup.ready:${digest}`
}

/** Splits a list into batches of at most `size` (rule 9). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
