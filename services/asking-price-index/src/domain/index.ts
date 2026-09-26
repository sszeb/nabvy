// Pure rules of the asking-price-index module: no I/O. Which listings may count, which group each
// ask joins, relist and copy collapse, the IQR fences and the figures (README.md, "Rules and
// thresholds"). Figures are computed only from real asks; nothing here invents a number.
import type {
  AskingPriceIndexCondition,
  AskingPriceIndexContext,
  AskingPriceIndexExclusion,
  AskingPriceIndexGroupKey,
  AskingPriceIndexSampleOrigin,
} from '@nabvy/contracts/modules/asking-price-index'

/** Everything the module reads about one listing's current version, from other modules' views. */
export interface ListingFacts {
  listingId: string
  /** listing-ingest: the card's ask. Never the displayed "was" price (PARTS_INTELLIGENCE.md:88). */
  priceMinor: number | null
  currency: 'GBP' | 'EUR'
  moneyKind: string | null
  availability: string
  binding: string | null
  cityPageId: string | null
  lastSeenAt: Date
  cardHash: string
  foundByTerms: string[]
  title: string
  /** detail-evidence: the current version; null until details are fetched. */
  evidenceHash: string | null
  condition: string | null
  description: string | null
  /** listing-assessment: the version's form (`system`, `bundle`, `part`, ...). */
  form: string | null
  /** parts-record: catalogue IDs of parts the listing offers (not mentions, not rejected). */
  offered: string[]
  /** noise-filter: the version has at least one noise reason. */
  noise: boolean
  /** city-pages: the country of the listing's centre. */
  country: string | null
  /** relist-merge group ID and copy-advert cluster key, when the listing is in one. */
  relistGroup: string | null
  copyCluster: string | null
  /** listing-suppression, seller-boosts (soft). */
  suppressed: boolean
  promoted: boolean
}

/** What the index knows about a catalogue item: its name (for the label) and its aliases. */
export interface CatalogueItem {
  name: string
  aliases: string[]
}

const CONDITIONS: readonly AskingPriceIndexCondition[] = [
  'used_fair',
  'used_good',
  'used_like_new',
  'new',
]

// Text that says the item has been used. "never used" and "unused" say the opposite.
const USED_TEXT = /\b(used|second[- ]hand|pre[- ]owned|preowned)\b/i
const NOT_USED_TEXT = /\b(never|not|barely|un)[- ]?used\b|\bunused\b/i

/**
 * The condition the ask is grouped on: the Condition attribute's machine value, lowered to
 * `used_good` when the attribute says new or like new but the text says used (the card: "when the
 * attribute and the text disagree, the lower condition"; the recorded listing marked "New" says
 * "Only used for 1 month"). Text alone never raises a condition. Null when no known attribute.
 */
export function groupCondition(
  attribute: string | null,
  text: string,
): AskingPriceIndexCondition | null {
  const stated = CONDITIONS.find((c) => c === attribute)
  if (!stated) return null
  const saysUsed = USED_TEXT.test(text.replace(NOT_USED_TEXT, ' '))
  if (saysUsed && (stated === 'new' || stated === 'used_like_new')) return 'used_good'
  return stated
}

/**
 * The context of each offered item: a part listing with one offered item is `standalone`; a
 * system is `in_pc`; a bundle, or a part listing offering several items, is `bundle`. Other forms
 * (box only, unknown) join no group.
 */
export function groupContext(form: string | null, offered: number): AskingPriceIndexContext | null {
  if (offered === 0) return null
  if (form === 'system') return 'in_pc'
  if (form === 'bundle') return 'bundle'
  if (form === 'part') return offered === 1 ? 'standalone' : 'bundle'
  return null
}

/** The stored string form of a group key. */
export function formatGroupKey(key: AskingPriceIndexGroupKey): string {
  return [
    key.catalogueId,
    key.context,
    key.condition,
    key.country,
    key.currency,
    `${key.windowDays}d`,
  ].join('|')
}

/** Each group key this listing's ask belongs to; none when it cannot be grouped. */
export function groupKeysOf(facts: ListingFacts, windowDays: number): AskingPriceIndexGroupKey[] {
  if (!facts.country || !/^[A-Z]{2}$/.test(facts.country)) return []
  const condition = groupCondition(facts.condition, `${facts.title}\n${facts.description ?? ''}`)
  if (!condition) return []
  const offered = [...new Set(facts.offered)].sort()
  const context = groupContext(facts.form, offered.length)
  if (!context) return []
  return offered.map((catalogueId) => ({
    catalogueId,
    context,
    condition,
    country: facts.country as string,
    currency: facts.currency,
    windowDays,
  }))
}

/**
 * Why this listing's ask does not count at all, or null when it may. Order: the reasons that hide
 * a listing, then those about the ask itself (EVIDENCE_LEDGER.md:194-195; README.md:451 of the
 * actor; SELLER_DATA.md:223-225).
 */
export function exclusionOf(facts: ListingFacts): AskingPriceIndexExclusion | null {
  if (facts.suppressed) return 'suppressed'
  if (facts.noise) return 'noise'
  if (facts.availability === 'sold') return 'sold'
  if (facts.priceMinor === null || facts.priceMinor === 0) return 'zero_price'
  if (facts.moneyKind !== 'fixed') return 'money_kind'
  if (facts.binding !== 'verified') return 'unverified_binding'
  if (facts.promoted) return 'promoted'
  return null
}

/** Whether an ask last seen at `seenAt` has left the window by `asOf`. */
export function isStale(seenAt: Date, asOf: Date, windowDays: number): boolean {
  return asOf.getTime() - seenAt.getTime() > windowDays * 86_400_000
}

/** Relist group first, then copy cluster, else the listing itself. */
export function collapseKeyOf(facts: ListingFacts): string {
  if (facts.relistGroup) return `relist:${facts.relistGroup}`
  if (facts.copyCluster) return `copy:${facts.copyCluster}`
  return `listing:${facts.listingId}`
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** `on_target` when a search term that found the listing names the item or one of its aliases. */
export function sampleOriginOf(
  foundByTerms: string[],
  item: CatalogueItem | undefined,
): AskingPriceIndexSampleOrigin {
  if (!item) return 'by_catch'
  const names = [item.name, ...item.aliases].map(normalise).filter((n) => n.length > 0)
  const hit = foundByTerms
    .map(normalise)
    .some((t) => t.length > 0 && names.some((n) => ` ${n} `.includes(` ${t} `) || ` ${t} `.includes(` ${n} `)))
  return hit ? 'on_target' : 'by_catch'
}

/** One member as the figures see it. */
export interface MemberInput {
  listingId: string
  askMinor: number
  /** Exclusion that keeps the listing out altogether, or null. */
  excluded: AskingPriceIndexExclusion | null
  collapseKey: string
  seenAt: Date
  /** Seller key, when seller-key supplies one (soft). Used in memory only. */
  sellerKey?: string | null
}

export interface MemberOutcome {
  listingId: string
  counted: boolean
  excluded: AskingPriceIndexExclusion | null
}

export interface Figures {
  n: number
  median: number | null
  mad: number | null
  p25: number | null
  p75: number | null
  min: number | null
  max: number | null
  thin: boolean
}

/** Linear-interpolation quantile (type 7) of sorted values. */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error('quantile of no values')
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (h - lo)
}

export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5)
}

/** Tukey fences Q1 − k·IQR and Q3 + k·IQR over the values. */
export function fences(values: number[], k: number): { low: number; high: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  return { low: q1 - k * (q3 - q1), high: q3 + k * (q3 - q1) }
}

export interface FigureOptions {
  iqrFence: number
  thinShare: number
  onePerSellerKey: boolean
}

const byListing = (a: { listingId: string }, b: { listingId: string }) =>
  a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0

/**
 * Decides which members count and computes the group's figures. Each collapse key counts once (its
 * newest-seen member, ties to the lowest listing ID); with seller keys, one ask per key; then asks
 * outside the IQR fences are cut. Figures are rounded to whole minor units.
 */
export function figures(
  members: MemberInput[],
  options: FigureOptions,
): { outcomes: MemberOutcome[]; figures: Figures } {
  const outcome = new Map<string, MemberOutcome>()
  const sorted = [...members].sort(byListing)
  for (const m of sorted) {
    outcome.set(m.listingId, { listingId: m.listingId, counted: false, excluded: m.excluded })
  }
  const eligible = sorted.filter((m) => m.excluded === null)

  // Relist and copy collapse: one member per collapse key.
  const kept = new Map<string, MemberInput>()
  for (const m of eligible) {
    const current = kept.get(m.collapseKey)
    if (!current || m.seenAt.getTime() > current.seenAt.getTime()) kept.set(m.collapseKey, m)
  }
  for (const m of eligible) {
    if (kept.get(m.collapseKey) !== m) {
      const reason = m.collapseKey.startsWith('copy:') ? 'copy' : 'relist'
      outcome.set(m.listingId, { listingId: m.listingId, counted: false, excluded: reason })
    }
  }
  let pool = [...kept.values()].sort(byListing)

  // One ask per seller key (soft: no keys, no effect).
  if (options.onePerSellerKey) {
    const seen = new Set<string>()
    pool = pool.filter((m) => {
      if (!m.sellerKey) return true
      if (!seen.has(m.sellerKey)) {
        seen.add(m.sellerKey)
        return true
      }
      outcome.set(m.listingId, { listingId: m.listingId, counted: false, excluded: 'seller' })
      return false
    })
  }

  // IQR fences.
  if (pool.length >= 4) {
    const { low, high } = fences(
      pool.map((m) => m.askMinor),
      options.iqrFence,
    )
    pool = pool.filter((m) => {
      if (m.askMinor >= low && m.askMinor <= high) return true
      outcome.set(m.listingId, { listingId: m.listingId, counted: false, excluded: 'outlier' })
      return false
    })
  }
  for (const m of pool) outcome.set(m.listingId, { listingId: m.listingId, counted: true, excluded: null })

  const values = pool.map((m) => m.askMinor).sort((a, b) => a - b)
  const keyCounts = new Map<string, number>()
  for (const m of pool) if (m.sellerKey) keyCounts.set(m.sellerKey, (keyCounts.get(m.sellerKey) ?? 0) + 1)
  const topShare = values.length === 0 ? 0 : Math.max(0, ...keyCounts.values()) / values.length
  const result: Figures =
    values.length === 0
      ? { n: 0, median: null, mad: null, p25: null, p75: null, min: null, max: null, thin: false }
      : {
          n: values.length,
          median: Math.round(quantile(values, 0.5)),
          mad: Math.round(median(values.map((v) => Math.abs(v - quantile(values, 0.5))))),
          p25: Math.round(quantile(values, 0.25)),
          p75: Math.round(quantile(values, 0.75)),
          min: values[0] as number,
          max: values[values.length - 1] as number,
          thin: topShare > options.thinShare,
        }
  return { outcomes: [...outcome.values()], figures: result }
}

/**
 * Split-half stability (PARTS_INTELLIGENCE.md:386-388): the counted asks, ordered by listing ID,
 * are dealt alternately into two halves; the check passes when the halves' medians differ by at
 * most `maxDrift` of the whole group's median. Null below `minN` asks.
 */
export function splitHalfStable(
  asks: { listingId: string; askMinor: number }[],
  maxDrift: number,
  minN: number,
): boolean | null {
  if (asks.length < minN) return null
  const ordered = [...asks].sort(byListing)
  const a = ordered.filter((_, i) => i % 2 === 0).map((m) => m.askMinor)
  const b = ordered.filter((_, i) => i % 2 === 1).map((m) => m.askMinor)
  const all = median(ordered.map((m) => m.askMinor))
  if (all === 0) return null
  return Math.abs(median(a) - median(b)) / all <= maxDrift
}

/** Whether two figure sets are the same (so `as_of` is kept and no event is sent). */
export function sameFigures(a: Figures & { copyCollapse: boolean }, b: Figures & { copyCollapse: boolean }): boolean {
  return (
    a.n === b.n &&
    a.median === b.median &&
    a.mad === b.mad &&
    a.p25 === b.p25 &&
    a.p75 === b.p75 &&
    a.min === b.min &&
    a.max === b.max &&
    a.thin === b.thin &&
    a.copyCollapse === b.copyCollapse
  )
}

/** A group's label for the user-facing band: item, context and condition. Never "worth" or "fair". */
export function labelOf(name: string, key: AskingPriceIndexGroupKey): string {
  const context = { standalone: 'on its own', in_pc: 'in a PC', bundle: 'in a bundle' }[key.context]
  const condition = {
    new: 'new',
    used_like_new: 'used, like new',
    used_good: 'used, good',
    used_fair: 'used, fair',
  }[key.condition]
  return `${name}, ${context}, ${condition}`
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
