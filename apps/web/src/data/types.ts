/**
 * Screen-facing shapes for the web app. These are what the screens render, not what the
 * database stores. When task 0.2 lands the oRPC output schemas in `@nabvy/contracts`, each type
 * here becomes a `z.infer` of the matching procedure output and this file shrinks to re-exports
 * (apps/web/README.md, "Data access").
 *
 * Deliberately absent, and enforced by test/fixtures.test.ts: any seller field (name, ID,
 * picture, profile link), coordinates or anything finer than a town, any price history that
 * crosses listing IDs, and the listing's free text (it can carry names and phone numbers; only
 * short quoted evidence and extracted facts reach the screen).
 */

import type { Currency, DeliveryMethod, Money, Source } from '@nabvy/contracts'
import type { WantManagerCadenceSeconds } from '@nabvy/contracts/modules/want-manager'

/** Shared core shapes come from the contracts package; they are never retyped here. */
export type { Currency, DeliveryMethod, Money, Source, WantManagerCadenceSeconds }

/** T-timestamps shown to the user, as ISO strings. A missing stage has not happened yet. */
export type Freshness = {
  listedAt: string
  foundAt: string
  deliveredAt?: string
}

/**
 * A fact quoted from the listing. Silence is never a "no": a fact the listing does not state is
 * shown as not stated, with a prompt to ask the seller.
 */
export type ListingFact = {
  label: string
  value?: string
  status: 'stated' | 'not_stated'
}

export type ListingSummary = {
  id: string
  source: Source
  title: string
  ask: Money
  /** Town only, never a street, postcode or coordinates. */
  town: string
  /** Distance from the user's hunt centre, whole kilometres. */
  distanceKm: number
  delivery: DeliveryMethod
  condition?: string
  keyFacts: ListingFact[]
  photoCount: number
  freshness: Freshness
  /** The listing on the marketplace, opened in a new tab. */
  listingUrl: string
}

export type PricePosition = {
  askMinor: number
  currency: Currency
  /** Comparable asks: same spec and condition, same currency group. */
  comparableCount: number
  comparableLabel: string
  /** Where this ask sits among comparable asks, 0 (lowest) to 100 (highest). */
  percentile: number
  range: {
    lowestMinor: number
    lowerQuartileMinor: number
    medianMinor: number
    upperQuartileMinor: number
    highestMinor: number
  }
  windowDays: number
}

export type EvidenceItem = { label: string; detail: string }

/**
 * A suspected-behaviour label: always worded as a suspicion, backed by listing-level evidence
 * from a documented rule, with a route to report a mistake. Never derived from seller data and
 * never a score. Scam labels stay in shadow mode and never reach this type until the owner and
 * legal review release them.
 */
export type Suspicion = {
  id: string
  kind: 'trade_seller' | 'copy_advert'
  facts: string
  evidence: EvidenceItem[]
  rule: string
}

/** A neutral warning sign: a plain fact, not a judgement. */
export type WarningSign = { id: string; text: string }

/** A price change on this listing ID only. Never joined across listing IDs. */
export type PriceChange = { at: string; ask: Money }

export type Deal = {
  id: string
  huntId: string
  huntName: string
  listing: ListingSummary
  /** Why this listing reached the user, in plain words. */
  matchReason: string
  position: PricePosition
  suspicions: Suspicion[]
  warnings: WarningSign[]
  priceChanges: PriceChange[]
  preparedMessage: string
  checklist: string[]
  feedback?: 'real_deal' | 'not_a_deal'
}

export type HuntStatus = 'active' | 'paused'

export type Hunt = {
  id: string
  name: string
  terms: string[]
  category: string
  postcodeDistrict: string
  radiusKm: number
  maxAsk?: Money
  delivery: 'all' | DeliveryMethod
  cadenceSeconds: WantManagerCadenceSeconds
  status: HuntStatus
  alertsThisWeek: number
  lastAlertAt?: string
  channels: ChannelKind[]
}

export type ChannelKind = 'telegram' | 'push' | 'email'

export type Channel = {
  kind: ChannelKind
  status: 'linked' | 'not_linked' | 'needs_install'
  detail: string
}

export type AlertDelivery = {
  id: string
  dealId: string
  listingTitle: string
  huntName: string
  channel: ChannelKind
  status: 'delivered' | 'queued' | 'failed'
  at: string
}

export type Account = {
  email: string
  displayName: string
  postcodeDistrict: string
  signInMethods: Array<'magic_link' | 'google'>
  createdAt: string
}

export type Preferences = {
  marketing: Array<{ id: string; label: string; description: string; enabled: boolean }>
  marketingPausedUntil?: string
  digestDay: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
}

export type DashboardSummary = {
  asOf: string
  alertsToday: number
  activeHunts: number
  medianListedToDeliveredMinutes: number
}

export type RunStatus = 'succeeded' | 'running' | 'failed' | 'aborted' | 'queued'

export type ActorRun = {
  id: string
  region: string
  job: 'search_newest' | 'search_catch_up' | 'details'
  status: RunStatus
  rows: number
  costUsd: number
  startedAt: string
  durationSeconds?: number
}

export type AdminOverview = {
  asOf: string
  providerEnabled: boolean
  spendTodayUsd: number
  spendCapUsd: number
  freshnessP50Minutes: number
  freshnessP95Minutes: number
  deadLetters: number
  runs: ActorRun[]
}

export type ReviewItem = {
  id: string
  reason: 'extraction_low_confidence' | 'label_reported' | 'spot_check'
  listingTitle: string
  town: string
  field: string
  extracted: string
  status: 'open' | 'corrected' | 'dismissed'
  queuedAt: string
}
