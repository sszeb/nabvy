// Pure matching rules: no I/O. A want (or a search) and a listing's parts, assessment, card and
// point in; one status per criterion and a verdict out (README.md, "Rules and thresholds").
// Silence is never a "no": `no_match` on a part needs positive evidence over a `full_verified`
// description; a price in another currency is never converted; an unknown distance is unstated.

import { createHash } from 'node:crypto'
import type { SpecMatchRules } from '@nabvy/config/modules/spec-match'
import type {
  SpecMatchCriterionResult,
  SpecMatchEvidence,
  SpecMatchOrigin,
  SpecMatchReason,
  SpecMatchVerdict,
} from '@nabvy/contracts/modules/spec-match'
import type { WantManagerCriterion } from '@nabvy/contracts/modules/want-manager'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** The rule version: `s<generation>.<first 8 hex of the rules' digest>`. */
export function ruleVersion(rules: SpecMatchRules): string {
  return `s${rules.ruleGeneration}.${sha256(JSON.stringify(rules)).slice(0, 8)}`
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/** A want as the rules read it (want-manager's `v_wants`, or a search shaped like one). */
export interface WantInput {
  id: string | null
  centreId: string | null
  /** Null for a search with no point: no distance criterion. */
  point: { lat: number; lng: number } | null
  radiusKm: number | null
  priceCapMinor: number | null
  currency: string
  deliveryMethods: readonly string[]
  criteria: readonly WantManagerCriterion[]
}

/** One part of parts-record's latest record of the listing's current version. */
export interface PartInput {
  seq: number
  partType: string
  catalogueId: string | null
  attrs: {
    family?: string
    candidates?: string[]
    gb?: number
    ddr?: number
    amount?: number
    unit?: 'gb' | 'tb'
  }
  inclusion: string
  rejected: boolean
  source: 'title' | 'description' | 'attribute' | 'photo'
  extractor: 'rules' | 'ai' | 'photo'
  quote: string
  start: number
  end: number
  conflict: boolean
}

/** listing-assessment's decisions for the same version (null while it is off). */
export interface AssessmentInput {
  container: boolean
  gpuState: string
  fullDescription: boolean
  exclusions: readonly {
    partType: string
    seq: number | null
    source: 'title' | 'description' | 'attribute' | 'photo'
    quote: string
    start: number
    end: number
  }[]
}

/** A search sighting of the listing: the terms and centres that found it. */
export interface SightingInput {
  terms: readonly string[]
  centreIds: readonly string[]
}

/** Everything the rules read about one listing. */
export interface ListingInput {
  listingId: string
  evidenceHash: string
  cardHash: string | null
  kind: string | null
  priceMinor: number | null
  currency: string | null
  deliveryTypes: readonly string[]
  parts: readonly PartInput[]
  assessment: AssessmentInput | null
  /** The distance to the want's point, when both points are known (rounded by `location`). */
  distanceKm: number | null
  sightings: readonly SightingInput[]
}

export interface Evaluation {
  verdict: SpecMatchVerdict
  criteria: SpecMatchCriterionResult[]
  /** A part criterion matches or is partly named: the pair is worth storing and showing. */
  relevant: boolean
  insidePc: boolean
  origin: SpecMatchOrigin
}

// ---------------------------------------------------------------------------------------------
// Part criteria
// ---------------------------------------------------------------------------------------------

/** `partial`: the part names a family that includes the wanted item, not the item itself. */
type Fit = 'yes' | 'partial' | 'maybe' | 'no'

/** Lower case, runs of anything but letters and digits as one `-`. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const isMobile = (id: string) => id.split(':').includes('mobile')

/** The catalogue ID's model segment (`gpu:nvidia:rtx-5080:16gb` → `rtx-5080`). */
const modelOf = (id: string) => id.split(':')[2] ?? ''

/** A catalogue ID is the wanted one, or one of its variants (`…:rtx-5080` → `…:rtx-5080:16gb`). */
const sameItem = (wanted: string, id: string) =>
  (id === wanted || id.startsWith(`${wanted}:`)) && (isMobile(wanted) || !isMobile(id))

/** A family name and a model segment or family name name the same thing. */
const sameFamily = (wanted: string, other: string) => {
  const a = norm(wanted)
  const b = norm(other)
  return a.length > 0 && b.length > 0 && (a === b || a.endsWith(`-${b}`) || b.endsWith(`-${a}`))
}

/** How one included GPU or CPU part fits a catalogue criterion. */
export function catalogueFit(c: WantManagerCriterion, p: PartInput): Fit {
  const id = p.catalogueId
  if (id) {
    // A mobile chip is a different part from the desktop card of the same name.
    if (isMobile(id) && !(c.catalogueId && isMobile(c.catalogueId))) return 'no'
    const named = c.catalogueId
      ? sameItem(c.catalogueId, id)
      : c.family !== null &&
        (sameFamily(c.family, modelOf(id)) || sameFamily(c.family, p.attrs.family ?? ''))
    if (named) return 'yes'
    // "Or better" needs a catalogue ranking, which no dependency publishes yet.
    return c.orBetter ? 'maybe' : 'no'
  }
  const candidates = p.attrs.candidates ?? []
  const family = p.attrs.family
  if (candidates.length === 0 && !family) return 'maybe' // a brand-only row names nothing
  const inCandidates = c.catalogueId
    ? candidates.some((x) => sameItem(c.catalogueId as string, x))
    : c.family !== null && candidates.some((x) => sameFamily(c.family as string, modelOf(x)))
  const inFamily = family !== undefined && c.family !== null && sameFamily(c.family, family)
  const familyOfWanted =
    family !== undefined && c.catalogueId !== null && sameFamily(modelOf(c.catalogueId), family)
  if (inCandidates || inFamily || familyOfWanted) {
    // A family names the want when the want names that family; a single wanted item inside a
    // family of several is not stated.
    return inFamily && !c.catalogueId ? 'yes' : 'partial'
  }
  return c.orBetter ? 'maybe' : 'no'
}

const RAM_TYPES = ['ram_size', 'ram_generation']
const STORAGE_TYPES = ['storage_size', 'storage_type']

/** The record's part types a criterion reads. */
export function partTypesOf(c: WantManagerCriterion): string[] {
  if (c.partType === 'ram') return RAM_TYPES
  if (c.partType === 'storage') return STORAGE_TYPES
  return [c.partType]
}

const toGb = (p: PartInput) =>
  p.attrs.amount === undefined ? undefined : p.attrs.amount * (p.attrs.unit === 'tb' ? 1000 : 1)

const evidenceOf = (parts: readonly PartInput[]): SpecMatchEvidence[] =>
  parts.slice(0, 10).map((p) => ({
    seq: p.seq,
    source: p.source,
    extractor: p.extractor,
    quote: p.quote.slice(0, 400),
    start: p.start,
    end: p.end,
  }))

function result(
  c: WantManagerCriterion,
  position: number,
  status: SpecMatchVerdict,
  reason: SpecMatchReason,
  evidence: SpecMatchEvidence[] = [],
): SpecMatchCriterionResult {
  return {
    kind: 'part',
    position,
    partType: c.partType,
    status,
    reason,
    evidence,
    distanceKm: null,
  }
}

/** RAM and storage: size (and RAM generation) against the included parts. */
function sizedFit(c: WantManagerCriterion, included: readonly PartInput[]) {
  const min = c.minAttr ?? {}
  const facts: { fit: Fit; parts: PartInput[] }[] = []
  if (c.partType === 'ram') {
    const sized = included.filter((p) => p.partType === 'ram_size' && p.attrs.gb !== undefined)
    if (min.sizeGb !== undefined) {
      const ok = sized.filter((p) => (p.attrs.gb as number) >= (min.sizeGb as number))
      facts.push(
        ok.length > 0
          ? { fit: 'yes', parts: ok }
          : sized.length > 0
            ? { fit: 'no', parts: sized }
            : { fit: 'maybe', parts: [] },
      )
    }
    if (min.generation !== undefined) {
      const want = /^ddr(\d)$/.exec(min.generation)?.[1]
      const gens = included.filter(
        (p) =>
          (p.partType === 'ram_generation' || p.partType === 'ram_size') &&
          p.attrs.ddr !== undefined,
      )
      const ok = want === undefined ? [] : gens.filter((p) => p.attrs.ddr === Number(want))
      facts.push(
        ok.length > 0
          ? { fit: 'yes', parts: ok }
          : gens.length > 0 && want !== undefined
            ? { fit: 'no', parts: gens }
            : { fit: 'maybe', parts: [] },
      )
    }
  } else {
    const sized = included.filter((p) => p.partType === 'storage_size' && toGb(p) !== undefined)
    if (min.sizeGb !== undefined) {
      const need = min.sizeGb
      const sizes = sized.map((p) => toGb(p) as number)
      const ok = sized.filter((p) => (toGb(p) as number) >= need)
      const total = sizes.reduce((a, b) => a + b, 0)
      facts.push(
        ok.length > 0
          ? { fit: 'yes', parts: ok }
          : sized.length === 0
            ? { fit: 'maybe', parts: [] }
            : total >= need
              ? { fit: 'maybe', parts: sized } // several drives: not one of the wanted size
              : { fit: 'no', parts: sized },
      )
    }
  }
  return facts
}

/** One part criterion against the listing. */
export function partCriterion(
  c: WantManagerCriterion,
  position: number,
  listing: ListingInput,
): SpecMatchCriterionResult {
  const included = listing.parts.filter((p) => p.inclusion === 'offered' && !p.rejected)
  const full = listing.assessment?.fullDescription === true
  const types = partTypesOf(c)
  const excluded = (listing.assessment?.exclusions ?? []).filter((e) => types.includes(e.partType))
  const exclusionEvidence: SpecMatchEvidence[] = excluded.slice(0, 10).map((e) => ({
    seq: e.seq,
    source: e.source,
    extractor: null,
    quote: e.quote.slice(0, 400),
    start: e.start,
    end: e.end,
  }))
  const against = (reason: SpecMatchReason, evidence: SpecMatchEvidence[]) =>
    full
      ? result(c, position, 'no_match', reason, evidence)
      : result(c, position, 'not_stated', 'partial_text', evidence)

  if (c.partType === 'gpu' || c.partType === 'cpu') {
    const ofType = included.filter((p) => p.partType === c.partType)
    const fits = ofType.map((p) => ({ p, fit: catalogueFit(c, p) }))
    const yes = fits.filter((f) => f.fit === 'yes').map((f) => f.p)
    const partial = fits.filter((f) => f.fit === 'partial').map((f) => f.p)
    const maybe = fits.filter((f) => f.fit === 'maybe').map((f) => f.p)
    if (yes.length > 0) {
      const conflicting =
        ofType.some((p) => p.conflict) ||
        (c.partType === 'gpu' && listing.assessment?.gpuState === 'conflicting')
      return conflicting
        ? result(c, position, 'not_stated', 'partly_named', evidenceOf(ofType))
        : result(c, position, 'match', 'named', evidenceOf(yes))
    }
    if (partial.length > 0)
      return result(c, position, 'not_stated', 'partly_named', evidenceOf(partial))
    if (maybe.length > 0) {
      const photoOnly = maybe.every((p) => p.source === 'photo')
      return result(
        c,
        position,
        'not_stated',
        photoOnly ? 'in_photos' : 'ambiguous',
        evidenceOf(maybe),
      )
    }
    if (excluded.length > 0) return against('excluded', exclusionEvidence)
    const gpuState = listing.assessment?.gpuState
    if (c.partType === 'gpu' && (gpuState === 'none' || gpuState === 'integrated')) {
      return against('excluded', exclusionEvidence)
    }
    if (ofType.length > 0) return against('different', evidenceOf(ofType))
    if (c.partType === 'gpu' && gpuState === 'in_photos') {
      return result(c, position, 'not_stated', 'in_photos')
    }
    return result(c, position, 'not_stated', 'not_named')
  }

  const facts = sizedFit(c, included)
  const shown = [...new Set(facts.flatMap((f) => f.parts))].sort((a, b) => a.seq - b.seq)
  if (facts.some((f) => f.fit === 'no')) {
    return against(
      'different',
      evidenceOf(facts.filter((f) => f.fit === 'no').flatMap((f) => f.parts)),
    )
  }
  if (excluded.length > 0 && facts.every((f) => f.fit !== 'yes')) {
    return against('excluded', exclusionEvidence)
  }
  if (facts.length > 0 && facts.every((f) => f.fit === 'yes')) {
    return result(c, position, 'match', 'named', evidenceOf(shown))
  }
  // One wanted attribute named (16GB), another not stated (the generation): partly named.
  const reason: SpecMatchReason = facts.some((f) => f.fit === 'yes')
    ? 'partly_named'
    : shown.length > 0
      ? 'ambiguous'
      : 'not_named'
  return result(c, position, 'not_stated', reason, evidenceOf(shown))
}

// ---------------------------------------------------------------------------------------------
// Price and distance
// ---------------------------------------------------------------------------------------------

const plain = (
  kind: 'price' | 'distance',
  status: SpecMatchVerdict,
  reason: SpecMatchReason,
  distanceKm: number | null = null,
): SpecMatchCriterionResult => ({
  kind,
  position: null,
  partType: null,
  status,
  reason,
  evidence: [],
  distanceKm,
})

/** The want's cap against the ask, in the want's currency only (never converted). */
export function priceCriterion(
  want: WantInput,
  listing: ListingInput,
): SpecMatchCriterionResult | null {
  if (want.priceCapMinor === null) return null
  if (listing.priceMinor === null || listing.currency === null)
    return plain('price', 'not_stated', 'no_price')
  if (listing.currency !== want.currency) return plain('price', 'not_stated', 'other_currency')
  return listing.priceMinor <= want.priceCapMinor
    ? plain('price', 'match', 'within_cap')
    : plain('price', 'no_match', 'over_cap')
}

/** The want's area and handover against the listing's point and delivery types. */
export function distanceCriterion(
  want: WantInput,
  listing: ListingInput,
  rules: Pick<SpecMatchRules, 'postedDeliveryTypes'>,
): SpecMatchCriterionResult | null {
  if (want.point === null || want.radiusKm === null) return null
  const collects = want.deliveryMethods.includes('collection')
  const acceptsPosted = want.deliveryMethods.includes('posted')
  const known = listing.deliveryTypes.length > 0
  const posts = listing.deliveryTypes.some((t) => rules.postedDeliveryTypes.includes(t))
  if (acceptsPosted && posts) return plain('distance', 'match', 'posted', listing.distanceKm)
  if (!collects) {
    return known
      ? plain('distance', 'no_match', 'not_posted', listing.distanceKm)
      : plain('distance', 'not_stated', 'unknown_point', listing.distanceKm)
  }
  if (listing.distanceKm === null) return plain('distance', 'not_stated', 'unknown_point')
  if (listing.distanceKm <= want.radiusKm) {
    return plain('distance', 'match', 'within_radius', listing.distanceKm)
  }
  // Beyond the radius: a "no" unless the want accepts posting and the listing's handover is unknown.
  return acceptsPosted && !known
    ? plain('distance', 'not_stated', 'beyond_radius', listing.distanceKm)
    : plain('distance', 'no_match', 'beyond_radius', listing.distanceKm)
}

// ---------------------------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------------------------

/** Every criterion matches: `match`; one has evidence against: `no_match`; else `not_stated`. */
export function verdictOf(criteria: readonly SpecMatchCriterionResult[]): SpecMatchVerdict {
  if (criteria.some((c) => c.status === 'no_match')) return 'no_match'
  return criteria.every((c) => c.status === 'match') ? 'match' : 'not_stated'
}

/** The search terms a criterion is known by: its family, or its catalogue model segment. */
const termsOf = (c: WantManagerCriterion) =>
  [c.family, c.catalogueId ? modelOf(c.catalogueId) : null]
    .filter((t): t is string => !!t)
    .map(norm)

/**
 * `own_search` when a search for the want's centre and one of its parts found the listing;
 * otherwise another user's search did (`other_search`).
 */
export function originOf(want: WantInput, listing: ListingInput): SpecMatchOrigin {
  const names = want.criteria.flatMap(termsOf).filter((t) => t.length > 0)
  const own = listing.sightings.some(
    (s) =>
      want.centreId !== null &&
      s.centreIds.includes(want.centreId) &&
      s.terms.some((term) => {
        const t = norm(term)
        return names.some((n) => t === n || t.includes(n))
      }),
  )
  return own ? 'own_search' : 'other_search'
}

/** Whether the listing is a container (a PC): the assessment's decision, else the record's kind. */
export const insidePcOf = (listing: ListingInput) =>
  listing.assessment ? listing.assessment.container : listing.kind === 'pc'

/** Matches one want (or search) against one listing. */
export function evaluate(
  want: WantInput,
  listing: ListingInput,
  rules: Pick<SpecMatchRules, 'postedDeliveryTypes'>,
): Evaluation {
  const parts = want.criteria.map((c, i) => partCriterion(c, i, listing))
  const price = priceCriterion(want, listing)
  const distance = distanceCriterion(want, listing, rules)
  const criteria = [...parts, ...(price ? [price] : []), ...(distance ? [distance] : [])]
  return {
    verdict: verdictOf(criteria),
    criteria,
    relevant: parts.some((p) => p.status === 'match' || p.reason === 'partly_named'),
    insidePc: insidePcOf(listing),
    origin: originOf(want, listing),
  }
}

/** SHA-256 of what a stored verdict says and the versions it read (the row's `input_hash`). */
export function inputHash(want: WantInput, listing: ListingInput, e: Evaluation): string {
  return sha256(
    JSON.stringify({
      want: {
        criteria: want.criteria,
        cap: want.priceCapMinor,
        currency: want.currency,
        point: want.point,
        radius: want.radiusKm,
        handover: [...want.deliveryMethods].sort(),
        centre: want.centreId,
      },
      evidence: listing.evidenceHash,
      card: listing.cardHash,
      verdict: e.verdict,
      criteria: e.criteria,
      insidePc: e.insidePc,
      origin: e.origin,
    }),
  )
}

/** The `spec-match.matched` key: the sorted match IDs of the batch, then its index. */
export function matchedKey(matchIds: readonly string[], batch: number): string {
  return `spec-match.matched:${sha256([...matchIds].sort().join('\n'))}:${batch}`
}

// ---------------------------------------------------------------------------------------------
// Search order
// ---------------------------------------------------------------------------------------------

/** What a sort reads about one result. */
export interface SortFacts {
  listingId: string
  distanceKm: number | null
  /** The ask in the search's currency; null for another currency or no price. */
  priceMinor: number | null
  listedAt: string | null
  /** The asking-price position when it is shown (n at or above the minimum); else null. */
  position: number | null
}

const nullsLast = (a: number | null, b: number | null) =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b

const newest = (a: SortFacts, b: SortFacts) =>
  (b.listedAt ?? '').localeCompare(a.listedAt ?? '') || a.listingId.localeCompare(b.listingId)

/**
 * Orders results by the owner's sorts; unknowns sort last, then newest first. A hidden position
 * is null here, so it sorts with the unknowns and never leaks through the order.
 */
export function compareBy(sort: 'nearest' | 'cheapest' | 'newest' | 'best_position') {
  return (a: SortFacts, b: SortFacts): number => {
    if (sort === 'nearest') return nullsLast(a.distanceKm, b.distanceKm) || newest(a, b)
    if (sort === 'cheapest') return nullsLast(a.priceMinor, b.priceMinor) || newest(a, b)
    if (sort === 'best_position') return nullsLast(a.position, b.position) || newest(a, b)
    return newest(a, b)
  }
}
