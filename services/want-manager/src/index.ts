// Public API of the want-manager module: the functions other modules and tasks may call. Other
// modules import from '@nabvy/want-manager' only, never from its internals. It stores what each
// user wants and how they want to hear about it (README.md). Every user write runs inside
// withUser, as nabvy_app: row-level security is the only isolation a caller needs. The
// pipeline-facing reads (wantOwners) run inside withPipeline.
import { isActive } from '@nabvy/account'
import { createEvent, type EventEnvelope, err, ok, type Result, Uuid } from '@nabvy/contracts'
import type { LocationPoint } from '@nabvy/contracts/modules/location'
import {
  events,
  type WantManagerCriterion,
  WantManagerDeleteWantInput,
  type WantManagerError,
  type WantManagerFeedFilter,
  type WantManagerPreferences,
  type WantManagerPreview,
  WantManagerSetActiveInput,
  WantManagerSetPreferencesInput,
  WantManagerUpsertWantInput,
  type WantManagerWant,
} from '@nabvy/contracts/modules/want-manager'
import type { Queryable } from '@nabvy/db'
import { LocationRefused, pointForPostcode as locationPointForPostcode } from '@nabvy/location'
import { getEntitlement } from '@nabvy/subscriptions'
import { state } from '@nabvy/switches'
import {
  activeWantCap,
  changedKey,
  defaultPreferences,
  deletedKey,
  type WantContent,
  wantVersionHash,
} from './domain'
import {
  type CriterionRow,
  countActiveWants,
  deleteWantRow,
  fairUseWantCap,
  insertWant,
  nearestCentre,
  selectOwners,
  selectPreferences,
  selectWant,
  selectWantsMine,
  updateWant,
  updateWantActive,
  upsertPreferences,
  type WantRow,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/want-manager'
export { activeWantCap, changedKey, deletedKey, wantVersionHash } from './domain'
export { onAccountDeleted } from './handlers'

// ---------------------------------------------------------------------------------------------
// Ports (soft edges and outside calls, injected so tests and callers without them still run)
// ---------------------------------------------------------------------------------------------

/**
 * How many current deals a want would match: `listing-search`'s preview, a soft edge
 * (docs/design/modules/soft-edges.json). Until that module ships, the stub answers null and the
 * want screen shows no count (docs/questions/want-manager.md).
 */
export type WantManagerSearchPreview = (
  q: Queryable,
  want: Omit<WantContent, 'centreId' | 'centreVerified'> & { centreId: string | null },
) => Promise<number | null>

/** The documented stub: no listing-search yet, so no count. */
export const noSearchPreview: WantManagerSearchPreview = async () => null

export interface WantManagerDeps {
  /** A postcode's point. Defaults to `@nabvy/location`'s `pointForPostcode` (postcodes.io). */
  pointForPostcode?: (q: Queryable, postcode: string) => Promise<LocationPoint | undefined>
  /** The soft edge to listing-search. Defaults to `noSearchPreview`. */
  searchPreview?: WantManagerSearchPreview
  /** The user's entitlement. Defaults to `@nabvy/subscriptions`' `getEntitlement`. */
  entitlementWants?: (q: Queryable, userId: string) => Promise<number>
}

const defaultDeps: Required<WantManagerDeps> = {
  pointForPostcode: locationPointForPostcode,
  searchPreview: noSearchPreview,
  entitlementWants: async (q, userId) => (await getEntitlement(q, userId)).wants,
}

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

export interface UpsertWantOutcome {
  want: WantManagerWant
  /** True when this call inserted the want. */
  created: boolean
  /** False when the stored want already had exactly this content and nothing was written. */
  changed: boolean
  /** `want-manager.changed`, for the caller to publish after its transaction commits. */
  event: EventEnvelope
}

export interface ChangedOutcome {
  wantId: string
  changed: boolean
  event: EventEnvelope
}

export interface PreferencesOutcome {
  preferences: WantManagerPreferences
  created: boolean
}

type Fail = Result<never, WantManagerError>

const off = (): Fail => err({ code: 'want-manager.off', message: 'Wants are unavailable.' })
const restricted = (): Fail =>
  err({
    code: 'want-manager.account_restricted',
    message: 'The account may not change wants right now.',
  })
const notFound = (): Fail => err({ code: 'want-manager.not_found', message: 'No such want.' })

async function gate(q: Queryable, userId: string): Promise<Fail | null> {
  if ((await state(q, 'want-manager')) === 'off') return off()
  if (!(await isActive(q, userId))) return restricted()
  return null
}

/** The postcode's point and its nearest centre, or the error the screen shows. */
async function resolvePlace(
  q: Queryable,
  postcode: string,
  deps: Required<WantManagerDeps>,
): Promise<
  Result<
    { lat: number; lng: number; centreId: string | null; centreVerified: boolean },
    WantManagerError
  >
> {
  if ((await state(q, 'location')) === 'off') {
    return err({
      code: 'want-manager.location_unavailable',
      message: 'Postcode lookup is unavailable right now.',
    })
  }
  let point: LocationPoint | undefined
  try {
    point = await deps.pointForPostcode(q, postcode)
  } catch (error) {
    if (error instanceof LocationRefused) {
      return err({
        code: 'want-manager.location_unavailable',
        message: 'Postcode lookup is unavailable right now.',
      })
    }
    throw error
  }
  if (!point) {
    return err({ code: 'want-manager.postcode_unknown', message: 'We do not know that postcode.' })
  }
  const centre = await nearestCentre(q, point.lat, point.lng)
  return ok({
    lat: point.lat,
    lng: point.lng,
    centreId: centre?.centreId ?? null,
    centreVerified: centre?.verified ?? false,
  })
}

async function capFor(
  q: Queryable,
  userId: string,
  deps: Required<WantManagerDeps>,
): Promise<number> {
  const subscriptionsState = await state(q, 'subscriptions')
  return activeWantCap({
    subscriptionsState,
    entitlementWants: subscriptionsState === 'off' ? null : await deps.entitlementWants(q, userId),
    fairUseMaxActiveHunts: await fairUseWantCap(q),
  })
}

/** Refuses when activating this want would put the user over their cap. */
async function overCap(
  q: Queryable,
  userId: string,
  excludeWantId: string | null,
  deps: Required<WantManagerDeps>,
): Promise<Fail | null> {
  const [active, cap] = await Promise.all([
    countActiveWants(q, userId, excludeWantId),
    capFor(q, userId, deps),
  ])
  if (active >= cap) {
    return err({
      code: 'want-manager.limit_reached',
      message: 'You have reached the number of active wants your plan allows.',
    })
  }
  return null
}

const toCriterion = (row: CriterionRow): WantManagerCriterion => ({
  partType: row.partType as WantManagerCriterion['partType'],
  catalogueId: row.catalogueId,
  family: row.family,
  minAttr: (row.minAttr as WantManagerCriterion['minAttr']) ?? null,
  orBetter: row.orBetter,
})

function toWant(row: WantRow, criteria: CriterionRow[]): WantManagerWant {
  return {
    id: row.id,
    userId: row.userId,
    radiusKm: row.radiusKm,
    centreId: row.centreId,
    centreVerified: row.centreVerified,
    priceCapMinor: row.priceCapMinor,
    currency: row.currency as WantManagerWant['currency'],
    active: row.active,
    cadenceSeconds: row.cadenceSeconds as WantManagerWant['cadenceSeconds'],
    deliverySpeed: row.deliverySpeed as WantManagerWant['deliverySpeed'],
    deliveryMethods: row.deliveryMethods as WantManagerWant['deliveryMethods'],
    alternatives: row.alternatives as WantManagerWant['alternatives'],
    pcContainment: row.pcContainment,
    alternativesMaxPriceMinor: row.alternativesMaxPriceMinor,
    instantAlternatives: row.instantAlternatives,
    instantTopPicks: row.instantTopPicks,
    filter: (row.filter as WantManagerFeedFilter | null) ?? null,
    criteria: criteria.map(toCriterion),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const contentOf = (row: WantRow, criteria: CriterionRow[]): WantContent => ({
  lat: row.lat,
  lng: row.lng,
  radiusKm: row.radiusKm,
  centreId: row.centreId,
  centreVerified: row.centreVerified,
  priceCapMinor: row.priceCapMinor,
  currency: row.currency,
  active: row.active,
  cadenceSeconds: row.cadenceSeconds,
  deliverySpeed: row.deliverySpeed,
  deliveryMethods: row.deliveryMethods,
  alternatives: row.alternatives,
  pcContainment: row.pcContainment,
  alternativesMaxPriceMinor: row.alternativesMaxPriceMinor,
  instantAlternatives: row.instantAlternatives,
  instantTopPicks: row.instantTopPicks,
  filter: (row.filter as WantManagerFeedFilter | null) ?? null,
  criteria: criteria.map(toCriterion),
})

function changedEvent(wantId: string, key: string): EventEnvelope {
  return createEvent(
    events,
    'want-manager.changed',
    1,
    { wantIds: [wantId] },
    { key },
  ) as EventEnvelope
}

// ---------------------------------------------------------------------------------------------
// User functions (inside withUser)
// ---------------------------------------------------------------------------------------------

/**
 * Creates a want, or replaces the user's own want named by `wantId` whole (docs/design/modules/
 * want-manager.md). The point comes from the postcode through `location`; the postcode is never
 * stored. The nearest active centre is attached (verified or not). Activating a want counts
 * against the cap (`activeWantCap`). Safe to run twice: the same content writes nothing and
 * republishes the same event key, which the transport drops.
 */
export async function upsertWant(
  q: Queryable,
  rawInput: WantManagerUpsertWantInput,
  deps: WantManagerDeps = {},
): Promise<Result<UpsertWantOutcome, WantManagerError>> {
  const parsed = WantManagerUpsertWantInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'want-manager.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  const d = { ...defaultDeps, ...deps }
  const refused = await gate(q, input.userId)
  if (refused) return refused

  const existing = input.wantId ? await selectWant(q, input.wantId) : undefined
  if (input.wantId && !existing) return notFound()

  const place = await resolvePlace(q, input.postcode, d)
  if (!place.ok) return place
  const content: WantContent = {
    lat: place.value.lat,
    lng: place.value.lng,
    radiusKm: input.radiusKm,
    centreId: place.value.centreId,
    centreVerified: place.value.centreVerified,
    priceCapMinor: input.priceCapMinor,
    currency: input.currency,
    active: input.active,
    cadenceSeconds: input.cadenceSeconds,
    deliverySpeed: input.deliverySpeed,
    deliveryMethods: input.deliveryMethods,
    alternatives: input.alternatives,
    pcContainment: input.pcContainment,
    alternativesMaxPriceMinor: input.alternativesMaxPriceMinor,
    instantAlternatives: input.instantAlternatives,
    instantTopPicks: input.instantTopPicks,
    filter: input.filter,
    criteria: input.criteria,
  }
  const versionHash = wantVersionHash(content)

  if (existing && existing.want.versionHash === versionHash) {
    return ok({
      want: toWant(existing.want, existing.criteria),
      created: false,
      changed: false,
      event: changedEvent(existing.want.id, changedKey(existing.want.id, versionHash)),
    })
  }
  if (input.active && !existing?.want.active) {
    const capped = await overCap(q, input.userId, existing?.want.id ?? null, d)
    if (capped) return capped
  }
  const row = existing
    ? await updateWant(q, existing.want.id, input.userId, content, versionHash)
    : await insertWant(q, input.userId, content, versionHash)
  const stored = await selectWant(q, row.id)
  if (!stored) throw new Error('want vanished after write')
  return ok({
    want: toWant(stored.want, stored.criteria),
    created: !existing,
    changed: true,
    event: changedEvent(row.id, changedKey(row.id, versionHash)),
  })
}

/** Pauses or resumes the user's own want. Resuming counts against the cap. Idempotent. */
export async function setActive(
  q: Queryable,
  rawInput: WantManagerSetActiveInput,
  deps: WantManagerDeps = {},
): Promise<Result<ChangedOutcome, WantManagerError>> {
  const parsed = WantManagerSetActiveInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'want-manager.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  const d = { ...defaultDeps, ...deps }
  const refused = await gate(q, input.userId)
  if (refused) return refused
  const existing = await selectWant(q, input.wantId)
  if (!existing) return notFound()
  if (existing.want.active === input.active) {
    return ok({
      wantId: existing.want.id,
      changed: false,
      event: changedEvent(
        existing.want.id,
        changedKey(existing.want.id, existing.want.versionHash),
      ),
    })
  }
  if (input.active) {
    const capped = await overCap(q, input.userId, existing.want.id, d)
    if (capped) return capped
  }
  const versionHash = wantVersionHash({
    ...contentOf(existing.want, existing.criteria),
    active: input.active,
  })
  const row = await updateWantActive(q, existing.want.id, input.active, versionHash)
  if (!row) return notFound()
  return ok({
    wantId: row.id,
    changed: true,
    event: changedEvent(row.id, changedKey(row.id, versionHash)),
  })
}

/** Deletes the user's own want and its criteria. A second call finds nothing (`not_found`). */
export async function deleteWant(
  q: Queryable,
  rawInput: WantManagerDeleteWantInput,
): Promise<Result<ChangedOutcome, WantManagerError>> {
  const parsed = WantManagerDeleteWantInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'want-manager.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return refused
  const gone = await deleteWantRow(q, input.wantId)
  if (!gone) return notFound()
  return ok({
    wantId: input.wantId,
    changed: true,
    event: changedEvent(input.wantId, deletedKey(input.wantId)),
  })
}

/**
 * The user's own wants, newest first, through the tables under RLS (the same rows the user-facing
 * view `v_want_manager_wants` shows). Off: an empty list, like the view.
 */
export async function listWants(q: Queryable, userId: string): Promise<WantManagerWant[]> {
  Uuid.parse(userId)
  if ((await state(q, 'want-manager')) !== 'on') return []
  const rows = await selectWantsMine(q)
  return rows.map(({ want, criteria }) => toWant(want, criteria))
}

/**
 * What the want screen shows before saving: the centre the postcode maps to (so the screen can
 * state that area's check interval) and, through the soft edge to listing-search, how many
 * current deals the want would match (null until that module ships). Writes nothing.
 */
export async function previewWant(
  q: Queryable,
  rawInput: WantManagerUpsertWantInput,
  deps: WantManagerDeps = {},
): Promise<Result<WantManagerPreview, WantManagerError>> {
  const parsed = WantManagerUpsertWantInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'want-manager.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  const d = { ...defaultDeps, ...deps }
  if ((await state(q, 'want-manager')) === 'off') return off()
  const place = await resolvePlace(q, input.postcode, d)
  if (!place.ok) return place
  const matchingDeals = await d.searchPreview(q, {
    lat: place.value.lat,
    lng: place.value.lng,
    centreId: place.value.centreId,
    radiusKm: input.radiusKm,
    priceCapMinor: input.priceCapMinor,
    currency: input.currency,
    active: input.active,
    cadenceSeconds: input.cadenceSeconds,
    deliverySpeed: input.deliverySpeed,
    deliveryMethods: input.deliveryMethods,
    alternatives: input.alternatives,
    pcContainment: input.pcContainment,
    alternativesMaxPriceMinor: input.alternativesMaxPriceMinor,
    instantAlternatives: input.instantAlternatives,
    instantTopPicks: input.instantTopPicks,
    filter: input.filter,
    criteria: input.criteria,
  })
  return ok({
    centreId: place.value.centreId,
    centreVerified: place.value.centreVerified,
    matchingDeals,
  })
}

/** The user's preferences, or the defaults when they have never set any. */
export async function getPreferences(
  q: Queryable,
  userId: string,
): Promise<WantManagerPreferences> {
  Uuid.parse(userId)
  const row = await selectPreferences(q, userId)
  if (!row) return defaultPreferences(userId)
  return {
    userId: row.userId,
    hideNoise: row.hideNoise,
    hideSpam: row.hideSpam,
    hideMultiQuantity: row.hideMultiQuantity,
    channels: row.channels as WantManagerPreferences['channels'],
    quietHours: (row.quietHours as WantManagerPreferences['quietHours']) ?? null,
  }
}

/** Replaces the user's preferences whole. Safe to run twice: one row per user. */
export async function setPreferences(
  q: Queryable,
  rawInput: WantManagerSetPreferencesInput,
): Promise<Result<PreferencesOutcome, WantManagerError>> {
  const parsed = WantManagerSetPreferencesInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'want-manager.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  const refused = await gate(q, input.userId)
  if (refused) return refused
  const { created } = await upsertPreferences(q, input)
  return ok({ preferences: await getPreferences(q, input.userId), created })
}

// ---------------------------------------------------------------------------------------------
// Pipeline functions (inside withPipeline)
// ---------------------------------------------------------------------------------------------

/**
 * The owner of each want, for the modules that deliver to a user (alert-router, notifier). A
 * function, not a view, because no internal view carries a user ID (card, "Views"); at most 500
 * IDs per call (CLAUDE.md, "Batches, not items"). Off: an empty map, like the views.
 */
export async function wantOwners(
  q: Queryable,
  wantIds: readonly string[],
): Promise<Map<string, string>> {
  if (wantIds.length > 500) throw new RangeError('wantOwners takes at most 500 IDs per call')
  if (wantIds.length === 0 || (await state(q, 'want-manager')) === 'off') return new Map()
  return selectOwners(q, [...new Set(wantIds.map((id) => Uuid.parse(id)))])
}

export type { CriterionRow, WantRow }
