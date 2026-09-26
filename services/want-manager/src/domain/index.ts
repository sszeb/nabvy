// Pure logic of the want-manager module: the want's version hash and event keys, the active-want
// cap, and the preference defaults. No I/O.
import { createHash } from 'node:crypto'
import { WANT_MANAGER_FREE_ACTIVE_WANT_LIMIT } from '@nabvy/config/modules/want-manager'
import type {
  WantManagerCriterion,
  WantManagerFeedFilter,
  WantManagerPreferences,
} from '@nabvy/contracts/modules/want-manager'

/** Everything about a want that the pipeline reads: the content its version hash covers. */
export interface WantContent {
  lat: number
  lng: number
  radiusKm: number
  centreId: string | null
  centreVerified: boolean
  priceCapMinor: number | null
  currency: string
  active: boolean
  cadenceSeconds: number
  deliverySpeed: string
  deliveryMethods: string[]
  alternatives: string
  pcContainment: boolean
  alternativesMaxPriceMinor: number | null
  instantAlternatives: boolean
  instantTopPicks: boolean
  filter: WantManagerFeedFilter | null
  criteria: WantManagerCriterion[]
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * sha256 of the want's content in canonical form (sorted keys, delivery methods sorted, undefined
 * dropped): the "version" of rule 8 in docs/design/modules/_rules.md. Two saves of the same want
 * hash the same, whatever the key order the form sent, so a replay writes nothing and republishes
 * the same event key.
 */
export function wantVersionHash(content: WantContent): string {
  const normalised = { ...content, deliveryMethods: [...content.deliveryMethods].sort() }
  return createHash('sha256').update(canonical(normalised)).digest('hex')
}

/** The `want-manager.changed` key for a saved want: its ID and its version hash. */
export const changedKey = (wantId: string, versionHash: string): string =>
  `want-manager.changed:${wantId}@${versionHash.slice(0, 16)}`

/** The `want-manager.changed` key for a deleted want: its ID and the literal `deleted`. */
export const deletedKey = (wantId: string): string => `want-manager.changed:${wantId}@deleted`

/**
 * How many wants a user may have active at once: the entitlement's `wants` when `subscriptions`
 * is on (or in shadow: it still writes), else the Free limit (card: "with it off, the Free limit
 * of 3 active wants applies"); a fair-use limit from `account` (`maxActiveHunts`) only ever
 * lowers it.
 */
export function activeWantCap(input: {
  subscriptionsState: 'off' | 'shadow' | 'on'
  entitlementWants: number | null
  fairUseMaxActiveHunts: number | null
}): number {
  const tier =
    input.subscriptionsState === 'off' || input.entitlementWants === null
      ? WANT_MANAGER_FREE_ACTIVE_WANT_LIMIT
      : input.entitlementWants
  return input.fairUseMaxActiveHunts === null ? tier : Math.min(tier, input.fairUseMaxActiveHunts)
}

/**
 * What a user with no `preferences` row gets: noise and likely spam hidden, multi-quantity
 * listings shown, no channels chosen yet, no quiet hours (README.md, "Decisions").
 */
export const defaultPreferences = (userId: string): WantManagerPreferences => ({
  userId,
  hideNoise: true,
  hideSpam: true,
  hideMultiQuantity: false,
  channels: [],
  quietHours: null,
})
