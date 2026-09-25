// Pure rules of details-selector: which newly seen listings get a paid detail fetch
// (docs/design/modules/details-selector.md). No I/O.

/** What selection needs of a listing, from listing-ingest's `v_listings`. */
export interface Candidate {
  source: string
  sourceListingId: string
  /** The card version to select (rule 8's card-stage `contentHash`). */
  cardHash: string
  cityPageId: string | null
  /** Null (unknown) always counts as in: Facebook's category is unreliable (card). */
  categoryId: string | null
  deliveryTypes: string[]
}

/** city-pages' `v_area_membership` row for one city page. Absent means "unknown", never "no". */
export interface AreaFact {
  centreId: string | null
  inArea: boolean
}

export interface Selection {
  source: string
  sourceListingId: string
  cardHash: string
  reason: 'in_area' | 'shipped'
}

/**
 * True unless the category is known and is not one of `inCategoryIds` (card: "electronics, a
 * container, a GPU, or unknown, whatever its price or title"; no title keyword filter).
 */
export function categoryAllows(
  categoryId: string | null,
  inCategoryIds: ReadonlySet<string>,
): boolean {
  return categoryId === null || inCategoryIds.has(categoryId)
}

/**
 * Whether a candidate is selected, and why. `in_area`: its city page's nearest active centre is
 * within reach (city-pages' own `v_area_membership.inArea`, which today already applies the "100
 * km from the centre" fallback, since no want sets its own radius while want-manager is not built
 * — card). `shipped`: it offers shipping and an active want at that same centre accepts delivery
 * (`deliveryCentres`, empty until want-manager exists, so this branch is currently unreachable on
 * real data). A candidate whose city page has no area fact (unknown — city-pages off, or the page
 * has no active centre with a known coordinate) is never selected: unlike category, unknown area
 * is the conservative default here, since selection triggers a paid fetch
 * (docs/questions/details-selector.md).
 */
export function classify(
  candidate: Candidate,
  areaOf: ReadonlyMap<string, AreaFact>,
  deliveryCentres: ReadonlySet<string>,
  inCategoryIds: ReadonlySet<string>,
  shippingDeliveryTypes: ReadonlySet<string>,
): Selection | null {
  if (!categoryAllows(candidate.categoryId, inCategoryIds)) return null
  const area = candidate.cityPageId !== null ? areaOf.get(candidate.cityPageId) : undefined
  const base = {
    source: candidate.source,
    sourceListingId: candidate.sourceListingId,
    cardHash: candidate.cardHash,
  }
  if (area?.inArea) return { ...base, reason: 'in_area' }
  const offersShipping = candidate.deliveryTypes.some((t) => shippingDeliveryTypes.has(t))
  if (offersShipping && area?.centreId && deliveryCentres.has(area.centreId)) {
    return { ...base, reason: 'shipped' }
  }
  return null
}

/** Classifies a batch, dropping candidates that are not selected. */
export function selectBatch(
  candidates: readonly Candidate[],
  areaOf: ReadonlyMap<string, AreaFact>,
  deliveryCentres: ReadonlySet<string>,
  inCategoryIds: ReadonlySet<string>,
  shippingDeliveryTypes: ReadonlySet<string>,
): Selection[] {
  return candidates.flatMap((c) => {
    const s = classify(c, areaOf, deliveryCentres, inCategoryIds, shippingDeliveryTypes)
    return s ? [s] : []
  })
}

/** Splits an array into batches of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
