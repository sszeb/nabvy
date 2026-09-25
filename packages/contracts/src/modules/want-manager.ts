import { z } from 'zod'
import { AmountMinor, Currency, DeliveryMethod, defineEvents, IsoTimestamp, Uuid } from '../index'
import { ProductCatalogueId, ProductCatalogueKind } from './product-catalogue'

// Contracts of the want-manager module (services/want-manager, docs/design/modules/
// want-manager.md): what each user wants (a want: spec criteria over parts, a price cap, a point
// and radius, delivery methods, a check cadence and a delivery speed), how they want to hear
// about it (preferences), and the `want-manager.changed` event. Import from
// '@nabvy/contracts/modules/want-manager'. Every input is bounded; no schema here carries a
// computed price, margin or estimate (CLAUDE.md, "No invented numbers"): the only money is the
// user's own cap. Samples in fixtures/contracts/want-manager/.

export const module = 'want-manager'

// ---------------------------------------------------------------------------------------------
// Cadence (task 4.1q's slider; kept as it shipped, the want form and its tests import these)
// ---------------------------------------------------------------------------------------------

/**
 * The check-interval ladder a want's cadence can be set to (docs/design/cadence-slider.md),
 * fastest last so a higher array index always means a faster check: 4 h, 2 h, 1 h, 30 min,
 * 15 min, 5 min, 1 min (seven steps; the names are settled in docs/design/cadence-slider.md).
 */
export const WANT_MANAGER_CADENCE_STEP_SECONDS = [14400, 7200, 3600, 1800, 900, 300, 60] as const
export const WantManagerCadenceSeconds = z.union(
  WANT_MANAGER_CADENCE_STEP_SECONDS.map((seconds) => z.literal(seconds)) as [
    z.ZodLiteral<(typeof WANT_MANAGER_CADENCE_STEP_SECONDS)[number]>,
    z.ZodLiteral<(typeof WANT_MANAGER_CADENCE_STEP_SECONDS)[number]>,
    ...z.ZodLiteral<(typeof WANT_MANAGER_CADENCE_STEP_SECONDS)[number]>[],
  ],
)
export type WantManagerCadenceSeconds = z.infer<typeof WantManagerCadenceSeconds>

/**
 * What the want-manager estimate procedure (not built yet; the web app passes `null` until it
 * ships, README.md "Open questions") returns for a chosen cadence: never computed in the browser
 * (CLAUDE.md, "No invented numbers"). Optional fields carry no meaning when absent, so they are
 * `null`, never omitted: `deliveredCadenceSeconds` is set only when the want's area currently
 * delivers slower than `chosenCadenceSeconds`; `unlockWatchersNeeded`/`unlockCadenceSeconds` are
 * set together, only when the next faster step is reachable by more watchers in the area rather
 * than a plan upgrade; `creditsRunOutDate` is set only when credits run out before the billing
 * period ends.
 */
export const WantManagerCadenceEstimate = z
  .strictObject({
    chosenCadenceSeconds: WantManagerCadenceSeconds,
    /** The fastest cadence the want's plan allows without an upgrade. */
    planCeilingSeconds: WantManagerCadenceSeconds,
    creditsPerMonth: z.number().nonnegative(),
    deliveredCadenceSeconds: WantManagerCadenceSeconds.nullable(),
    unlockWatchersNeeded: z.int().positive().nullable(),
    unlockCadenceSeconds: WantManagerCadenceSeconds.nullable(),
    creditsRunOutDate: IsoTimestamp.nullable(),
  })
  .refine(
    (estimate) =>
      estimate.deliveredCadenceSeconds === null ||
      estimate.deliveredCadenceSeconds > estimate.chosenCadenceSeconds,
    {
      message: 'deliveredCadenceSeconds must be slower than chosenCadenceSeconds when set',
      path: ['deliveredCadenceSeconds'],
    },
  )
  .refine(
    (estimate) =>
      (estimate.unlockWatchersNeeded === null) === (estimate.unlockCadenceSeconds === null),
    {
      message: 'unlockWatchersNeeded and unlockCadenceSeconds are set together',
      path: ['unlockCadenceSeconds'],
    },
  )
export type WantManagerCadenceEstimate = z.infer<typeof WantManagerCadenceEstimate>

/**
 * A free account's burst-mode standing (docs/design/cadence-slider.md, "Burst mode"): the fixed
 * four-phase timeline itself is product copy, not user data, so it lives in the web app's own
 * constants (apps/web/src/lib/cadence.ts); only these per-user numbers cross the boundary.
 */
export const WantManagerCadenceBurstStatus = z.strictObject({
  usedThisWeek: z.int().nonnegative(),
  weeklyLimit: z.int().positive(),
  resetsInHours: z.number().nonnegative(),
  /** Minutes elapsed in the current burst, for the static position marker. */
  elapsedMinutes: z.number().nonnegative(),
})
export type WantManagerCadenceBurstStatus = z.infer<typeof WantManagerCadenceBurstStatus>

// ---------------------------------------------------------------------------------------------
// Enums (derived where another module owns the vocabulary; never retyped)
// ---------------------------------------------------------------------------------------------

/**
 * How fast a match reaches the user (card, "Does / does not"): Instant (push or Telegram as soon
 * as a match is found, the default), Batched every 15 or 60 minutes, or a Daily digest.
 */
export const WantManagerDeliverySpeed = z.enum(['instant', 'batched_15', 'batched_60', 'daily'])
export type WantManagerDeliverySpeed = z.infer<typeof WantManagerDeliverySpeed>

/**
 * How the user accepts the item: the build pack's handover vocabulary minus the two values that
 * describe a listing rather than a wish (`both` is "collection and posted" spelled out; `unknown`
 * is never something a user asks for).
 */
export const WantManagerDeliveryMethod = z.enum(
  DeliveryMethod.options.filter(
    (m): m is 'collection' | 'posted' => m !== 'both' && m !== 'unknown',
  ),
)
export type WantManagerDeliveryMethod = z.infer<typeof WantManagerDeliveryMethod>

/** Where alerts for a want may go. Matches the channel names `subscriptions` entitles. */
export const WantManagerChannel = z.enum(['push', 'telegram', 'email'])
export type WantManagerChannel = z.infer<typeof WantManagerChannel>

/**
 * Per-want alternative controls (card): off, variants only, or variants plus one tier either side
 * (the default).
 */
export const WantManagerAlternatives = z.enum(['off', 'variants', 'variants_plus_tier'])
export type WantManagerAlternatives = z.infer<typeof WantManagerAlternatives>

/**
 * What a criterion is about: a catalogue kind (`gpu`, `cpu`, derived from product-catalogue) named
 * by catalogue ID or family, or a sized part (`ram`, `storage`) named by a minimum size and, for
 * RAM, a generation (card: "32GB+ DDR5 and an RTX 4080 or better").
 */
export const WantManagerPartType = z.enum([...ProductCatalogueKind.options, 'ram', 'storage'])
export type WantManagerPartType = z.infer<typeof WantManagerPartType>

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/** A family name as product-catalogue spells it (`ProductCatalogueItem.family`). */
const Family = z.string().min(1).max(100)

/** A user's own price figure in minor units: positive and bounded (a cap, never a valuation). */
export const WantManagerPriceMinor = AmountMinor.positive().max(100_000_000)
export type WantManagerPriceMinor = z.infer<typeof WantManagerPriceMinor>

/** Minimum attributes of a sized part. Sizes in GB; the generation is a short token (`ddr5`). */
export const WantManagerMinAttr = z.strictObject({
  sizeGb: z.int().positive().max(1_000_000).optional(),
  generation: z
    .string()
    .regex(/^[a-z0-9]{1,16}$/)
    .optional(),
})
export type WantManagerMinAttr = z.infer<typeof WantManagerMinAttr>

/**
 * One spec criterion of a want (card, "Owns": `criteria`). A `gpu`/`cpu` criterion names a
 * catalogue ID or a family, never both empty; a `ram`/`storage` criterion carries `minAttr`.
 * `orBetter` widens a named part or family to anything the catalogue ranks above it.
 */
export const WantManagerCriterion = z
  .strictObject({
    partType: WantManagerPartType,
    catalogueId: ProductCatalogueId.nullable(),
    family: Family.nullable(),
    minAttr: WantManagerMinAttr.nullable(),
    orBetter: z.boolean(),
  })
  .refine(
    (c) =>
      c.partType === 'ram' || c.partType === 'storage'
        ? c.minAttr !== null
        : c.catalogueId !== null || c.family !== null,
    { message: 'a catalogue part names an ID or a family; a sized part carries minAttr' },
  )
export type WantManagerCriterion = z.infer<typeof WantManagerCriterion>

/**
 * The saved feed filter "Save as hunt" writes (docs/design/search-map-routes.md; card, "Owns").
 * `listing-search` owns `FeedFilter` and is not built yet (a soft edge, docs/design/modules/
 * soft-edges.json), so this is a bounded placeholder with the same name prefix: every field
 * optional, sizes capped, nothing computed. When listing-search lands, its `FeedFilter` replaces
 * this shape without changing the stored column (docs/questions/want-manager.md).
 */
export const WantManagerFeedFilter = z.strictObject({
  query: z.string().max(200).optional(),
  sort: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/)
    .optional(),
  priceMinMinor: WantManagerPriceMinor.optional(),
  priceMaxMinor: WantManagerPriceMinor.optional(),
  handover: z.array(DeliveryMethod).max(4).optional(),
  condition: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/))
    .max(10)
    .optional(),
})
export type WantManagerFeedFilter = z.infer<typeof WantManagerFeedFilter>

/** Quiet hours as minutes after local midnight, `[start, end)`; a window may cross midnight. */
export const WantManagerQuietHours = z.strictObject({
  startMinute: z.int().min(0).max(1439),
  endMinute: z.int().min(0).max(1439),
})
export type WantManagerQuietHours = z.infer<typeof WantManagerQuietHours>

/** Radius in whole kilometres. The user sets it freely (owner, 2026-09-24); the bound is a sanity cap. */
export const WantManagerRadiusKm = z.int().min(1).max(1000)

/** The per-want alert and alternative controls (card, "Does / does not", last sentence). */
const wantControls = {
  cadenceSeconds: WantManagerCadenceSeconds,
  deliverySpeed: WantManagerDeliverySpeed,
  deliveryMethods: z.array(WantManagerDeliveryMethod).min(1).max(2),
  alternatives: WantManagerAlternatives,
  pcContainment: z.boolean(),
  /** Cap for alternatives; null means the want's own cap. */
  alternativesMaxPriceMinor: WantManagerPriceMinor.nullable(),
  instantAlternatives: z.boolean(),
  instantTopPicks: z.boolean(),
}

/**
 * A user's own want, as `listWants()` returns it and as the user-facing view shows it. The point is
 * the user's own postcode's coordinate, never shown finer than the centre it maps to
 * (`centreId`), so the row carries no coordinates.
 */
export const WantManagerWant = z.strictObject({
  id: Uuid,
  userId: Uuid,
  radiusKm: WantManagerRadiusKm,
  /** The nearest active search centre (a city-pages ID), or null when none has a coordinate yet. */
  centreId: z.string().max(64).nullable(),
  centreVerified: z.boolean(),
  priceCapMinor: WantManagerPriceMinor.nullable(),
  currency: Currency,
  active: z.boolean(),
  ...wantControls,
  filter: WantManagerFeedFilter.nullable(),
  criteria: z.array(WantManagerCriterion).min(1).max(10),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type WantManagerWant = z.infer<typeof WantManagerWant>

/** A user's alert preferences (card, "Owns": `preferences`, keyed by user). */
export const WantManagerPreferences = z.strictObject({
  userId: Uuid,
  hideNoise: z.boolean(),
  hideSpam: z.boolean(),
  hideMultiQuantity: z.boolean(),
  channels: z.array(WantManagerChannel).max(3),
  quietHours: WantManagerQuietHours.nullable(),
})
export type WantManagerPreferences = z.infer<typeof WantManagerPreferences>

// ---------------------------------------------------------------------------------------------
// Inputs (web forms through oRPC procedures inside withUser)
// ---------------------------------------------------------------------------------------------

/** A UK postcode as typed: letters, digits and spaces only, bounded. Normalised by `location`. */
export const WantManagerPostcode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 ]{5,10}$/)

/**
 * Creates or replaces a want. With `wantId`, the user's own want of that ID is replaced whole
 * (criteria included); without, a new one is created. The point comes from the postcode through
 * `location`; the postcode itself is never stored. No client time anywhere.
 */
export const WantManagerUpsertWantInput = z.strictObject({
  userId: Uuid,
  wantId: Uuid.optional(),
  postcode: WantManagerPostcode,
  radiusKm: WantManagerRadiusKm,
  priceCapMinor: WantManagerPriceMinor.nullable(),
  currency: Currency,
  active: z.boolean(),
  ...wantControls,
  filter: WantManagerFeedFilter.nullable(),
  criteria: z.array(WantManagerCriterion).min(1).max(10),
})
export type WantManagerUpsertWantInput = z.infer<typeof WantManagerUpsertWantInput>

/** Pauses or resumes a want (the cap applies when resuming). */
export const WantManagerSetActiveInput = z.strictObject({
  userId: Uuid,
  wantId: Uuid,
  active: z.boolean(),
})
export type WantManagerSetActiveInput = z.infer<typeof WantManagerSetActiveInput>

/** Deletes a want and its criteria. */
export const WantManagerDeleteWantInput = z.strictObject({ userId: Uuid, wantId: Uuid })
export type WantManagerDeleteWantInput = z.infer<typeof WantManagerDeleteWantInput>

/** Replaces the user's preferences whole. */
export const WantManagerSetPreferencesInput = WantManagerPreferences
export type WantManagerSetPreferencesInput = WantManagerPreferences

/**
 * What the want screen shows before saving: the area's check interval and, through the soft
 * edge to `listing-search`, how many current deals the want would match (null until that module
 * ships). Never a credit figure: the estimate procedure is not built (README.md).
 */
export const WantManagerPreview = z.strictObject({
  centreId: z.string().max(64).nullable(),
  centreVerified: z.boolean(),
  matchingDeals: z.int().nonnegative().nullable(),
})
export type WantManagerPreview = z.infer<typeof WantManagerPreview>

// ---------------------------------------------------------------------------------------------
// Internal view rows (no user ID in any of them: card, "Views")
// ---------------------------------------------------------------------------------------------

/** One row of `want_manager.v_wants`: a want as the pipeline reads it (spec-match, alert-router). */
export const WantManagerPipelineWant = z.strictObject({
  id: Uuid,
  centreId: z.string().max(64).nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: WantManagerRadiusKm,
  priceCapMinor: WantManagerPriceMinor.nullable(),
  currency: Currency,
  active: z.boolean(),
  ...wantControls,
  filter: WantManagerFeedFilter.nullable(),
  criteria: z.array(WantManagerCriterion).min(1).max(10),
  /** The owner holds a paid entitlement in `subscriptions.v_entitlements`. */
  paid: z.boolean(),
  updatedAt: IsoTimestamp,
})
export type WantManagerPipelineWant = z.infer<typeof WantManagerPipelineWant>

/** One row of `want_manager.v_want_terms_by_centre`: want counts per centre and family. */
export const WantManagerTermsByCentre = z.strictObject({
  centreId: z.string().max(64),
  family: z.string().min(1).max(200),
  wantCount: z.int().nonnegative(),
  paidWantCount: z.int().nonnegative(),
})
export type WantManagerTermsByCentre = z.infer<typeof WantManagerTermsByCentre>

/** One row of `want_manager.v_want_parts`: a distinct wanted part per centre. */
export const WantManagerWantPart = z.strictObject({
  centreId: z.string().max(64),
  partType: WantManagerPartType,
  catalogueId: ProductCatalogueId.nullable(),
  family: Family.nullable(),
})
export type WantManagerWantPart = z.infer<typeof WantManagerWantPart>

/**
 * One row of `want_manager.v_want_areas` (for `details-selector`): a centre, the want's point
 * rounded to the area grid, its radius and whether it accepts a posted item.
 */
export const WantManagerWantArea = z.strictObject({
  centreId: z.string().max(64),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: WantManagerRadiusKm,
  acceptsDelivery: z.boolean(),
})
export type WantManagerWantArea = z.infer<typeof WantManagerWantArea>

// ---------------------------------------------------------------------------------------------
// Errors and events
// ---------------------------------------------------------------------------------------------

/** Error codes returned as values (rule 3 of docs/design/modules/_rules.md). */
export const WantManagerErrorCode = z.enum([
  'want-manager.off', //                  the module is off: no new or changed wants
  'want-manager.invalid_input', //        the form failed its schema
  'want-manager.account_restricted', //   the account is suspended or banned
  'want-manager.limit_reached', //        the active-want cap of the user's tier (or fair use)
  'want-manager.postcode_unknown', //     location knows no point for the postcode
  'want-manager.location_unavailable', // location is off or its provider is unreachable
  'want-manager.not_found', //            no such want of this user
])
export type WantManagerErrorCode = z.infer<typeof WantManagerErrorCode>

export const WantManagerError = z.strictObject({
  code: WantManagerErrorCode,
  message: z.string().min(1),
})
export type WantManagerError = z.infer<typeof WantManagerError>

/** The payload of `want-manager.changed`: want IDs only (rule 7), 1-500 per envelope. */
export const WantManagerChangedEvent = z.strictObject({
  wantIds: z.array(Uuid).min(1).max(500),
})
export type WantManagerChangedEvent = z.infer<typeof WantManagerChangedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  /** A want was created, replaced, paused, resumed or deleted. */
  'want-manager.changed': { 1: WantManagerChangedEvent },
})
