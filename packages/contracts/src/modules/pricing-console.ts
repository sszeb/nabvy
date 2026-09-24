import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the pricing-console module (services/pricing-console): the owner's price policy as
// versioned rows, never constants in code (docs/decisions.md, "Paid ladder"; "Watching is
// metered, prices are dynamic"; backlog 4.10a and 4.10b). Import from
// '@nabvy/contracts/modules/pricing-console'.
//
// Units, integers only: credits are whole credits; money is integer pence (`…Minor`, `…Pence`);
// cost is integer GBP micros (the cost-meter's unit; 1p = 10,000 micros); a rate per credit is
// GBP micros per credit (Starter's 1.00p gross is 10,000); ratios are basis points (10,000 = 1×).

export const module = 'pricing-console'

const Int = z.int().min(0).max(2_147_483_647)
const Positive = z.int().min(1).max(2_147_483_647)
/** A check interval in minutes: 1 minute to one day. */
export const PricingConsoleCadence = z.int().min(1).max(1440)
/** Basis points, 0–10,000 (a discount or a share). */
const Bps = z.int().min(0).max(10_000)

/** A policy row's key inside its kind: a tier name, a price item, a bundle, an offer, a setting. */
export const PricingConsoleKey = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/)
export type PricingConsoleKey = z.infer<typeof PricingConsoleKey>

/** The kinds of policy row. Each kind's value schema is below. */
export const PricingConsoleKind = z.enum([
  'tier',
  'price',
  'bundle',
  'offer',
  'free-tier',
  'setting',
  'cost-basis',
])
export type PricingConsoleKind = z.infer<typeof PricingConsoleKind>

// ---------------------------------------------------------------------------------------------
// Values, one schema per kind
// ---------------------------------------------------------------------------------------------

/**
 * A paid plan on the ladder (docs/decisions.md, "Paid ladder"). The base cadence is included for
 * the plan's areas and funded by the fee; the floor is the fastest a want can buy with credits.
 * Both are the plan's ceiling for want-manager, check-scheduler and the cadence slider.
 */
export const PricingConsoleTier = z
  .strictObject({
    baseCadenceMinutes: PricingConsoleCadence,
    floorCadenceMinutes: PricingConsoleCadence,
    /** Credits granted each renewal, use it or lose it (usage-ledger `grantAllowance`). */
    bundledCredits: Int,
    /** Prices include VAT. `yearlyPriceMinor` null: by contract only (Business). */
    monthlyPriceMinor: Int,
    yearlyPriceMinor: Int.nullable(),
    /** The tier's top-up rate, gross (shown to users) and net (what a credit earns Nabvy). */
    topupGrossMicrosPerCredit: Positive,
    topupNetMicrosPerCredit: Positive,
    areas: Positive,
    wants: Positive,
    /** Checks may run outside daytime hours (Business: "1 min, round the clock"). */
    roundTheClock: z.boolean(),
  })
  .refine((t) => t.floorCadenceMinutes <= t.baseCadenceMinutes, {
    message: 'the floor cadence is at least as fast as the base cadence',
    path: ['floorCadenceMinutes'],
  })
  .refine((t) => t.topupNetMicrosPerCredit <= t.topupGrossMicrosPerCredit, {
    message: 'the net top-up rate is at most the gross rate',
    path: ['topupNetMicrosPerCredit'],
  })
export type PricingConsoleTier = z.infer<typeof PricingConsoleTier>

/**
 * A unit price (the card's `price_rules`). `each`: a metered checking action, costing
 * `costUnits` × the named cost basis (null: costs Nabvy nothing, e.g. an export). `area-month`:
 * watching one area at a cadence for a month, daytime hours; its cost is shared by every watcher
 * of the area, so its floor is kept by check-scheduler's funding rule (README, "Decisions").
 */
export const PricingConsolePriceRule = z.discriminatedUnion('unit', [
  z.strictObject({
    unit: z.literal('each'),
    credits: Int,
    costBasis: PricingConsoleKey.nullable(),
    costUnits: z.int().min(1).max(1000),
  }),
  z.strictObject({
    unit: z.literal('area-month'),
    credits: Positive,
    cadenceMinutes: PricingConsoleCadence,
  }),
])
export type PricingConsolePriceRule = z.infer<typeof PricingConsolePriceRule>

/**
 * A top-up pack (credit bundle) with its volume discount: `grossMinor` buys credits at the tier's
 * top-up rate less `discountBps`. `tier` null: sold on every tier.
 */
export const PricingConsoleBundle = z.strictObject({
  tier: PricingConsoleKey.nullable(),
  grossMinor: Positive,
  discountBps: z.int().min(0).max(9_000),
})
export type PricingConsoleBundle = z.infer<typeof PricingConsoleBundle>

/**
 * What an offer or a quote prices: a unit price (`price:<key>`) or a plan's fee
 * (`plan:<tier>:monthly`, `plan:<tier>:yearly`).
 */
export const PricingConsoleItem = z
  .string()
  .regex(/^(price:[a-z][a-z0-9-]{0,62}|plan:[a-z][a-z0-9-]{0,62}:(monthly|yearly))$/)
export type PricingConsoleItem = z.infer<typeof PricingConsoleItem>

/** Who an offer is for: every user, the users of one plan, or one user. */
export const PricingConsoleSegment = z.string().regex(/^(all|plan:[a-z][a-z0-9-]{0,62})$/)
export type PricingConsoleSegment = z.infer<typeof PricingConsoleSegment>

/** A promotion for one user or a segment, live from `startsAt` until `endsAt`. */
export const PricingConsoleOffer = z
  .strictObject({
    userId: Uuid.nullable(),
    segment: PricingConsoleSegment.nullable(),
    item: PricingConsoleItem,
    discountBps: Bps.min(1),
    startsAt: IsoTimestamp,
    endsAt: IsoTimestamp,
  })
  .refine((o) => (o.userId === null) !== (o.segment === null), {
    message: 'an offer is for one user or one segment',
    path: ['segment'],
  })
  .refine((o) => Date.parse(o.endsAt) > Date.parse(o.startsAt), {
    message: 'an offer ends after it starts',
    path: ['endsAt'],
  })
export type PricingConsoleOffer = z.infer<typeof PricingConsoleOffer>

/** One step of a free burst: checks every `cadenceMinutes` for `minutes`. */
export const PricingConsoleBurstStep = z.strictObject({
  cadenceMinutes: PricingConsoleCadence,
  minutes: z.int().min(1).max(10_080),
})
export type PricingConsoleBurstStep = z.infer<typeof PricingConsoleBurstStep>

/**
 * The free-tier policy (backlog 4.10a; docs/decisions.md, "Free tier: bursts under a lifetime
 * cap"). `bursts[i]` is window i's shape; windows past the list repeat its last shape. Null caps
 * and limits are not set: the reading module applies its own conservative default.
 */
export const PricingConsoleFreeTier = z
  .strictObject({
    wantCount: z.int().min(0).max(100),
    windowCount: z.int().min(0).max(100),
    windowMinutes: z.int().min(1).max(10_080),
    resetHours: z.int().min(0).max(8_760),
    bursts: z.array(z.array(PricingConsoleBurstStep).min(1).max(20)).min(1).max(100),
    lifetimeCapPence: Int,
    userWeekCapPence: Int.nullable(),
    userMonthCapPence: Int.nullable(),
    poolDayFloorPence: Int,
    poolRevenueShareBps: Bps,
    poolWeekPence: Int.nullable(),
    poolMonthPence: Int.nullable(),
    signupsPerIpDay: Positive.nullable(),
    signupsPerDeviceDay: Positive.nullable(),
    signupsPerEmailDomainDay: Positive.nullable(),
  })
  .refine((f) => f.bursts.every((b) => b.reduce((s, x) => s + x.minutes, 0) === f.windowMinutes), {
    message: "each burst's steps add up to the window's length",
    path: ['bursts'],
  })
export type PricingConsoleFreeTier = z.infer<typeof PricingConsoleFreeTier>

/** The named numeric settings, each a policy row. */
export const PricingConsoleSettingKey = z.enum([
  /** The "Always profitable" floor: every sale earns at least this multiple of measured cost. */
  'min-margin-bps',
  /** VAT included in gross prices. */
  'vat-bps',
  /** Payment fees taken from each payment: a share and a fixed part. */
  'payment-fee-bps',
  'payment-fee-fixed-minor',
  /** Watching round the clock costs this multiple of daytime watching. */
  'round-the-clock-bps',
])
export type PricingConsoleSettingKey = z.infer<typeof PricingConsoleSettingKey>

export const PricingConsoleSetting = z.strictObject({ value: Int })
export type PricingConsoleSetting = z.infer<typeof PricingConsoleSetting>

/**
 * Where a unit's measured cost comes from: the mean `counted_gbp_micros` of the matching
 * `cost_meter.v_costs` calls over `windowDays`, once there are `minSamples` of them. The cost used
 * is the higher of that mean and `fallbackGbpMicros` (the last recorded measurement), so the
 * floor never rests on a cost lower than both.
 */
export const PricingConsoleCostBasis = z.strictObject({
  provider: z.enum(['apify', 'anthropic', 'ebay', 'cex']),
  module: z.string().min(1).max(64).nullable(),
  fallbackGbpMicros: Positive,
  windowDays: z.int().min(1).max(90),
  minSamples: z.int().min(1).max(100_000),
})
export type PricingConsoleCostBasis = z.infer<typeof PricingConsoleCostBasis>

// ---------------------------------------------------------------------------------------------
// Admin writes (through an admin procedure, as the pipeline; README, "Inputs")
// ---------------------------------------------------------------------------------------------

const change = <K extends PricingConsoleKind, V extends z.ZodType, Key extends z.ZodType>(
  kind: K,
  key: Key,
  value: V,
) =>
  z.strictObject({
    actorUserId: Uuid,
    kind: z.literal(kind),
    key,
    value,
    /** When the new version takes effect; now if omitted. Never in the past. */
    effectiveAt: IsoTimestamp.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })

/** A new version of one policy row. Refused if it breaks the floor (`pricing-console.below_floor`). */
export const PricingConsoleSetInput = z.discriminatedUnion('kind', [
  change('tier', PricingConsoleKey, PricingConsoleTier),
  change('price', PricingConsoleKey, PricingConsolePriceRule),
  change('bundle', PricingConsoleKey, PricingConsoleBundle),
  change('offer', PricingConsoleKey, PricingConsoleOffer),
  change('free-tier', z.literal('default'), PricingConsoleFreeTier),
  change('setting', PricingConsoleSettingKey, PricingConsoleSetting),
  change('cost-basis', PricingConsoleKey, PricingConsoleCostBasis),
])
export type PricingConsoleSetInput = z.infer<typeof PricingConsoleSetInput>

/** Withdraws a row (a tier, price, bundle or offer): a new version marked retired. */
export const PricingConsoleRetireInput = z.strictObject({
  actorUserId: Uuid,
  kind: z.enum(['tier', 'price', 'bundle', 'offer']),
  key: PricingConsoleKey,
  reason: z.string().trim().min(1).max(1000).optional(),
})
export type PricingConsoleRetireInput = z.infer<typeof PricingConsoleRetireInput>

/** A stored policy row, as `setPolicy` returns it. */
export const PricingConsolePolicyRow = z.strictObject({
  id: Uuid,
  kind: PricingConsoleKind,
  key: PricingConsoleKey,
  version: Positive,
  value: z.record(z.string(), z.json()),
  retired: z.boolean(),
  effectiveAt: IsoTimestamp,
  createdBy: Uuid.nullable(),
  reason: z.string().nullable(),
})
export type PricingConsolePolicyRow = z.infer<typeof PricingConsolePolicyRow>

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** What `priceFor` prices, and for whom. `plan` lets plan-segment offers apply. */
export const PricingConsolePriceForInput = z.strictObject({
  userId: Uuid,
  item: PricingConsoleItem,
  plan: PricingConsoleKey.nullable().default(null),
})
export type PricingConsolePriceForInput = z.input<typeof PricingConsolePriceForInput>

/**
 * A price for one user now. `amount` is what to charge: credits for a unit price, gross pence for
 * a plan fee. `floored`: the list or offer price was below the floor, so the floor applied.
 */
export const PricingConsoleQuote = z.strictObject({
  item: PricingConsoleItem,
  currency: z.enum(['credits', 'gbp-minor']),
  list: Int,
  amount: Int,
  offer: PricingConsoleKey.nullable(),
  floored: z.boolean(),
  policyVersion: z.string().min(1).max(200),
})
export type PricingConsoleQuote = z.infer<typeof PricingConsoleQuote>

/** A want as the estimate needs it: the plan, the check interval and the areas it covers. */
export const PricingConsoleEstimateInput = z.strictObject({
  userId: Uuid,
  plan: PricingConsoleKey,
  cadenceMinutes: PricingConsoleCadence,
  areaCount: z.int().min(1).max(1000),
  roundTheClock: z.boolean().default(false),
})
export type PricingConsoleEstimateInput = z.input<typeof PricingConsoleEstimateInput>

/**
 * The monthly credit estimate shown before a want is saved. `included`: the cadence is at or
 * slower than the plan's base, so the fee funds it. `pricedCadenceMinutes`: the priced step used
 * (the nearest priced cadence at or faster than the one asked for).
 */
export const PricingConsoleEstimate = z.strictObject({
  plan: PricingConsoleKey,
  cadenceMinutes: PricingConsoleCadence,
  included: z.boolean(),
  pricedCadenceMinutes: PricingConsoleCadence.nullable(),
  creditsPerAreaMonth: Int,
  creditsPerMonth: Int,
  exceedsAreas: z.boolean(),
  offer: PricingConsoleKey.nullable(),
  policyVersion: z.string().min(1).max(200),
})
export type PricingConsoleEstimate = z.infer<typeof PricingConsoleEstimate>

// View rows (packages/db/src/schema/pricing-console.ts declares the views; test/contracts.test.ts
// fails if the columns drift).

export const PricingConsoleLadderRow = z.strictObject({
  tier: PricingConsoleKey,
  version: Positive,
  baseCadenceMinutes: PricingConsoleCadence,
  floorCadenceMinutes: PricingConsoleCadence,
  bundledCredits: Int,
  monthlyPriceMinor: Int,
  yearlyPriceMinor: Int.nullable(),
  topupGrossMicrosPerCredit: Positive,
  topupNetMicrosPerCredit: Positive,
  areas: Positive,
  wants: Positive,
  roundTheClock: z.boolean(),
  effectiveAt: z.date(),
})
export type PricingConsoleLadderRow = z.infer<typeof PricingConsoleLadderRow>

export const PricingConsolePriceRow = z.strictObject({
  item: PricingConsoleKey,
  version: Positive,
  unit: z.enum(['each', 'area-month']),
  credits: Int,
  cadenceMinutes: PricingConsoleCadence.nullable(),
  costBasis: PricingConsoleKey.nullable(),
  costUnits: z.int().nullable(),
  effectiveAt: z.date(),
})
export type PricingConsolePriceRow = z.infer<typeof PricingConsolePriceRow>

export const PricingConsoleOfferRow = z.strictObject({
  offer: PricingConsoleKey,
  version: Positive,
  userId: Uuid.nullable(),
  segment: PricingConsoleSegment.nullable(),
  item: PricingConsoleItem,
  discountBps: Bps,
  startsAt: z.date(),
  endsAt: z.date(),
})
export type PricingConsoleOfferRow = z.infer<typeof PricingConsoleOfferRow>

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export const PricingConsoleErrorCode = z.enum([
  /** The module is off: policy writes are refused (list prices still apply). */
  'pricing-console.off',
  /** The change would sell something below measured cost times the minimum margin. */
  'pricing-console.below_floor',
  /** The input is not valid, or names a time in the past. */
  'pricing-console.invalid',
  /** No current row for the item, plan or key. */
  'pricing-console.not_found',
  /** The cadence asked for is faster than the plan's floor. */
  'pricing-console.below_plan_floor',
  /** No watching price at or faster than the cadence asked for. */
  'pricing-console.no_price',
])
export type PricingConsoleErrorCode = z.infer<typeof PricingConsoleErrorCode>

export const PricingConsoleError = z.strictObject({
  code: PricingConsoleErrorCode,
  message: z.string(),
  /** On `below_floor`: what the floor refused, one line each. */
  violations: z.array(z.string()).optional(),
})
export type PricingConsoleError = z.infer<typeof PricingConsoleError>

/** Messages for admins (`below_floor`, `invalid`, `off`) and for users (the rest). */
export const PRICING_CONSOLE_MESSAGES: Record<PricingConsoleErrorCode, string> = {
  'pricing-console.off': 'Pricing changes are paused while the pricing console is off.',
  'pricing-console.below_floor':
    'This change would sell below measured cost plus the minimum margin, so it was not saved.',
  'pricing-console.invalid': 'This change is not valid.',
  'pricing-console.not_found': 'There is no price for this yet.',
  'pricing-console.below_plan_floor': 'Your plan does not include checks this fast.',
  'pricing-console.no_price': 'There is no price for checks this fast yet.',
}

/** Events this module publishes: none. Policy is read live; changes are audit-log rows. */
export const events = defineEvents(module, {})
