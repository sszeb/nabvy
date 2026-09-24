// Pure pricing logic: no I/O. The "Always profitable" floor (docs/decisions.md, "Watching is
// metered, prices are dynamic"), the paid ladder's arithmetic, offers and the want estimate.
//
// Units: credits; pence (`…Minor`); GBP micros (1p = 10,000); rates in GBP micros per credit,
// held as exact fractions of bigints so no comparison rounds; ratios in basis points.
import type {
  PricingConsoleBundle,
  PricingConsoleCostBasis,
  PricingConsoleFreeTier,
  PricingConsoleItem,
  PricingConsoleOffer,
  PricingConsolePriceRule,
  PricingConsoleSettingKey,
  PricingConsoleTier,
} from '@nabvy/contracts/modules/pricing-console'

const BPS = 10_000
const MICROS_PER_PENNY = 10_000

export interface Versioned<T> {
  key: string
  version: number
  value: T
}

/** The current policy: one versioned row per key and kind. */
export interface Policy {
  settings: Map<PricingConsoleSettingKey, Versioned<{ value: number }>>
  tiers: Map<string, Versioned<PricingConsoleTier>>
  prices: Map<string, Versioned<PricingConsolePriceRule>>
  bundles: Map<string, Versioned<PricingConsoleBundle>>
  offers: Map<string, Versioned<PricingConsoleOffer>>
  costBases: Map<string, Versioned<PricingConsoleCostBasis>>
  freeTier: Versioned<PricingConsoleFreeTier> | null
}

export const emptyPolicy = (): Policy => ({
  settings: new Map(),
  tiers: new Map(),
  prices: new Map(),
  bundles: new Map(),
  offers: new Map(),
  costBases: new Map(),
  freeTier: null,
})

/** Cost per unit of each cost basis, in GBP micros, as the floor uses it. */
export type Costs = ReadonlyMap<string, number>

/**
 * The cost the floor uses for a basis: the higher of the measured mean (null until enough calls)
 * and the recorded fallback, so the floor never rests on a cost lower than both.
 */
export function floorCost(basis: PricingConsoleCostBasis, measured: number | null): number {
  return Math.max(basis.fallbackGbpMicros, measured ?? 0)
}

export interface Settings {
  minMarginBps: number
  vatBps: number
  paymentFeeBps: number
  paymentFeeFixedMinor: number
  roundTheClockBps: number
}

const SETTING_KEYS: Record<keyof Settings, PricingConsoleSettingKey> = {
  minMarginBps: 'min-margin-bps',
  vatBps: 'vat-bps',
  paymentFeeBps: 'payment-fee-bps',
  paymentFeeFixedMinor: 'payment-fee-fixed-minor',
  roundTheClockBps: 'round-the-clock-bps',
}

/** The settings, or the keys that have no current row. */
export function settingsOf(policy: Policy): Settings | { missing: PricingConsoleSettingKey[] } {
  const missing: PricingConsoleSettingKey[] = []
  const out: Partial<Settings> = {}
  for (const [field, key] of Object.entries(SETTING_KEYS) as [
    keyof Settings,
    PricingConsoleSettingKey,
  ][]) {
    const row = policy.settings.get(key)
    if (row) out[field] = row.value.value
    else missing.push(key)
  }
  return missing.length > 0 ? { missing } : (out as Settings)
}

/**
 * What Nabvy keeps of a gross (VAT-inclusive) payment: less VAT, less the payment fee's share
 * (rounded up) and its fixed part (docs/design/pricing-model.md, "Unit economics": net = fee ÷ 1.2
 * − (2.7% × fee + 20p)). Rounded down, never below zero.
 */
export function netOfGrossMinor(grossMinor: number, s: Settings): number {
  if (grossMinor <= 0) return 0
  const exVat = Math.floor((grossMinor * BPS) / (BPS + s.vatBps))
  const fee = Math.ceil((grossMinor * s.paymentFeeBps) / BPS) + s.paymentFeeFixedMinor
  return Math.max(0, exVat - fee)
}

/** A price after a discount, rounded up (in Nabvy's favour). */
export function discounted(amount: number, discountBps: number): number {
  return Math.ceil((amount * (BPS - discountBps)) / BPS)
}

/** An exact rate: `num / den` GBP micros per credit. */
export interface Rate {
  num: bigint
  den: bigint
}

/** A way a credit is sold, and what it earns Nabvy net. */
export interface RateSource {
  id: string
  /** The policy rows it comes from, as `<kind>/<key>`. */
  rows: string[]
  label: string
  rate: Rate
}

const rate = (num: number, den: number): Rate => ({ num: BigInt(num), den: BigInt(den) })

/** Net micros per credit of a plan fee that bundles `credits` a month for `months` months. */
function planRate(grossMinor: number, credits: number, months: number, s: Settings): Rate {
  return rate(netOfGrossMinor(grossMinor, s) * MICROS_PER_PENNY, credits * months)
}

/**
 * Every way credit is sold under the current list prices: each tier's top-up rate, each top-up
 * pack's discounted rate, and each plan fee over its bundled credits, monthly and yearly. Offers
 * are left out (each offer is checked on its own when it is made).
 */
export function listRateSources(policy: Policy, s: Settings): RateSource[] {
  const out: RateSource[] = []
  for (const { key: tier, value: t } of policy.tiers.values()) {
    out.push({
      id: `tier/${tier}:topup`,
      rows: [`tier/${tier}`],
      label: `${tier} top-up`,
      rate: rate(t.topupNetMicrosPerCredit, 1),
    })
    if (t.bundledCredits > 0) {
      out.push({
        id: `tier/${tier}:monthly`,
        rows: [`tier/${tier}`],
        label: `${tier} monthly fee`,
        rate: planRate(t.monthlyPriceMinor, t.bundledCredits, 1, s),
      })
      if (t.yearlyPriceMinor !== null) {
        out.push({
          id: `tier/${tier}:yearly`,
          rows: [`tier/${tier}`],
          label: `${tier} yearly fee`,
          rate: planRate(t.yearlyPriceMinor, t.bundledCredits, 12, s),
        })
      }
    }
    for (const { key: pack, value: b } of policy.bundles.values()) {
      if (b.tier !== null && b.tier !== tier) continue
      if (b.discountBps === 0) continue
      out.push({
        id: `bundle/${pack}:${tier}`,
        rows: [`bundle/${pack}`, `tier/${tier}`],
        label: `${pack} pack on ${tier}`,
        rate: rate(t.topupNetMicrosPerCredit * (BPS - b.discountBps), BPS),
      })
    }
  }
  return out
}

/** The lowest rate among `sources`, or null when nothing is sold. */
export function lowestRate(sources: readonly RateSource[]): Rate | null {
  let low: Rate | null = null
  for (const { rate: r } of sources) {
    if (low === null || r.num * low.den < low.num * r.den) low = r
  }
  return low
}

/** A checking action's cost, or null when it costs Nabvy nothing. Undefined: unknown basis. */
export function unitCost(rule: PricingConsolePriceRule, costs: Costs): number | null | undefined {
  if (rule.unit !== 'each' || rule.costBasis === null) return null
  const cost = costs.get(rule.costBasis)
  return cost === undefined ? undefined : cost * rule.costUnits
}

/** Does `credits` sold at `r` earn at least `marginBps` × `costMicros`? */
export function covers(r: Rate, credits: number, costMicros: number, marginBps: number): boolean {
  return r.num * BigInt(credits) * BigInt(BPS) >= BigInt(marginBps) * BigInt(costMicros) * r.den
}

/** The fewest credits that earn `marginBps` × `costMicros` at rate `r` (the floor price). */
export function floorCredits(r: Rate, costMicros: number, marginBps: number): number {
  const need = BigInt(marginBps) * BigInt(costMicros) * r.den
  const per = r.num * BigInt(BPS)
  if (per === 0n) return Number.MAX_SAFE_INTEGER
  return Number((need + per - 1n) / per)
}

const pence = (micros: bigint | number) => (Number(micros) / MICROS_PER_PENNY).toFixed(3)

export interface Violation {
  /** Stable: the same breach has the same id before and after a change. */
  id: string
  /** The policy rows it involves, as `<kind>/<key>`. */
  rows: string[]
  message: string
}

/** Parses `plan:<tier>:<period>`, or null for a price item. */
export function planItem(
  item: PricingConsoleItem,
): { tier: string; period: 'monthly' | 'yearly' } | null {
  const m = /^plan:([a-z][a-z0-9-]*):(monthly|yearly)$/.exec(item)
  return m ? { tier: m[1] as string, period: m[2] as 'monthly' | 'yearly' } : null
}

/**
 * Checks the whole policy against the floor and its own consistency. The floor: every checking
 * action, at its list price or any offer's price, earns at least the minimum margin times its
 * measured cost at every rate credit is sold at, list or offered; and every plan offer keeps its
 * plan's rate above what the dearest checking action needs. Watching (credits per area-month) is
 * shared by every watcher of an area; its floor is the funding rule check-scheduler applies with
 * the same margin (README.md, "Decisions"), so here it needs only a positive price.
 */
export function floorViolations(policy: Policy, costs: Costs): Violation[] {
  const out: Violation[] = []
  const s = settingsOf(policy)
  if ('missing' in s) {
    for (const key of s.missing) {
      out.push({
        id: `setting/${key}`,
        rows: [`setting/${key}`],
        message: `setting ${key} has no current value`,
      })
    }
    return out
  }
  if (s.minMarginBps <= BPS) {
    out.push({
      id: 'setting/min-margin-bps',
      rows: ['setting/min-margin-bps'],
      message: `the minimum margin must be above 1x cost (now ${s.minMarginBps / BPS}x)`,
    })
  }
  if (s.paymentFeeBps >= BPS || s.vatBps >= BPS * 10) {
    out.push({
      id: 'setting/fees',
      rows: ['setting/vat-bps', 'setting/payment-fee-bps'],
      message: 'VAT or the payment fee is out of range',
    })
  }

  // Which checking actions are sold, and at what credits (list and offers).
  interface Sold {
    id: string
    rows: string[]
    label: string
    credits: number
    cost: number
  }
  const sold: Sold[] = []
  for (const { key, value: rule } of policy.prices.values()) {
    const cost = unitCost(rule, costs)
    if (cost === undefined) {
      out.push({
        id: `price/${key}:basis`,
        rows: [`price/${key}`],
        message: `price ${key} names cost basis ${rule.unit === 'each' ? rule.costBasis : ''}, which has no current row`,
      })
      continue
    }
    if (cost === null || rule.unit !== 'each') continue
    sold.push({
      id: `price/${key}`,
      rows: [`price/${key}`],
      label: `${key} at ${rule.credits} cr`,
      credits: rule.credits,
      cost,
    })
  }

  const sources = listRateSources(policy, s)
  for (const { key, value: o } of policy.offers.values()) {
    const plan = planItem(o.item)
    const segmentTier = o.segment?.startsWith('plan:') ? o.segment.slice(5) : null
    if (segmentTier !== null && !policy.tiers.has(segmentTier)) {
      out.push({
        id: `offer/${key}:segment`,
        rows: [`offer/${key}`],
        message: `offer ${key} is for plan ${segmentTier}, which has no current row`,
      })
    }
    if (plan) {
      const tier = policy.tiers.get(plan.tier)?.value
      const gross = plan.period === 'monthly' ? tier?.monthlyPriceMinor : tier?.yearlyPriceMinor
      if (!tier || gross === null || gross === undefined) {
        out.push({
          id: `offer/${key}:item`,
          rows: [`offer/${key}`],
          message: `offer ${key} prices ${o.item}, which is not sold`,
        })
        continue
      }
      if (tier.bundledCredits > 0) {
        sources.push({
          id: `offer/${key}`,
          rows: [`offer/${key}`, `tier/${plan.tier}`],
          label: `offer ${key} (${o.item} less ${o.discountBps / 100}%)`,
          rate: planRate(
            discounted(gross, o.discountBps),
            tier.bundledCredits,
            plan.period === 'monthly' ? 1 : 12,
            s,
          ),
        })
      }
      continue
    }
    const priceKey = o.item.slice('price:'.length)
    const rule = policy.prices.get(priceKey)?.value
    if (!rule) {
      out.push({
        id: `offer/${key}:item`,
        rows: [`offer/${key}`],
        message: `offer ${key} prices ${o.item}, which is not sold`,
      })
      continue
    }
    const cost = unitCost(rule, costs)
    if (cost === null || cost === undefined || rule.unit !== 'each') continue
    const credits = discounted(rule.credits, o.discountBps)
    sold.push({
      id: `offer/${key}`,
      rows: [`offer/${key}`, `price/${priceKey}`],
      label: `offer ${key} (${priceKey} at ${credits} cr)`,
      credits,
      cost,
    })
  }

  for (const item of sold) {
    if (item.credits === 0) {
      out.push({
        id: `${item.id}:free`,
        rows: item.rows,
        message: `${item.label} is given away but costs ${pence(item.cost)}p`,
      })
      continue
    }
    for (const src of sources) {
      if (covers(src.rate, item.credits, item.cost, s.minMarginBps)) continue
      const earns = (src.rate.num * BigInt(item.credits)) / src.rate.den
      out.push({
        id: `${item.id}@${src.id}`,
        rows: [...item.rows, ...src.rows],
        message: `${item.label} earns ${pence(earns)}p at the ${src.label}, below ${s.minMarginBps / BPS}x its cost of ${pence(item.cost)}p`,
      })
    }
  }

  for (const { key, value: t } of policy.tiers.values()) {
    if (
      t.floorCadenceMinutes < t.baseCadenceMinutes &&
      !watchPriceFor(policy, t.floorCadenceMinutes)
    ) {
      out.push({
        id: `tier/${key}:floor-price`,
        rows: [`tier/${key}`],
        message: `${key}'s floor of ${t.floorCadenceMinutes} min has no watching price at or faster than it`,
      })
    }
  }
  for (const { key, value: b } of policy.bundles.values()) {
    if (b.tier !== null && !policy.tiers.has(b.tier)) {
      out.push({
        id: `bundle/${key}:tier`,
        rows: [`bundle/${key}`],
        message: `pack ${key} is for tier ${b.tier}, which has no current row`,
      })
    }
  }
  if (policy.freeTier) {
    const check = costs.get('check')
    const ft = policy.freeTier.value
    if (check === undefined) {
      out.push({
        id: 'free-tier/default:basis',
        rows: ['free-tier/default', 'cost-basis/check'],
        message: 'the free tier needs the cost basis "check"',
      })
    } else {
      const cost = freeTierChecks(ft).reduce((a, n) => a + n, 0) * check
      if (cost > ft.lifetimeCapPence * MICROS_PER_PENNY) {
        out.push({
          id: 'free-tier/default:cap',
          rows: ['free-tier/default'],
          message: `the free bursts cost ${pence(cost)}p lone, above the lifetime cap of ${ft.lifetimeCapPence}p`,
        })
      }
    }
  }
  return out
}

/**
 * What a change to `row` (`<kind>/<key>`) is refused for: every breach in `after` that `before`
 * did not have, and every breach still involving the changed row (so a price already below the
 * floor, after costs rose, can only be changed to one that clears it).
 */
export function newViolations(
  before: readonly Violation[],
  after: readonly Violation[],
  row: string,
): Violation[] {
  const had = new Set(before.map((v) => v.id))
  return after.filter((v) => !had.has(v.id) || v.rows.includes(row))
}

/** Checks in each free window: each step runs ⌈minutes ÷ cadence⌉ checks. */
export function freeTierChecks(ft: PricingConsoleFreeTier): number[] {
  return Array.from({ length: ft.windowCount }, (_, i) => {
    const shape = ft.bursts[Math.min(i, ft.bursts.length - 1)] ?? []
    return shape.reduce((n, step) => n + Math.ceil(step.minutes / step.cadenceMinutes), 0)
  })
}

/**
 * The watching price for a cadence: the priced cadence nearest to it at or faster than it (so a
 * want is never priced below a faster step it may be served at). Null: none that fast.
 */
export function watchPriceFor(
  policy: Policy,
  cadenceMinutes: number,
): (Versioned<PricingConsolePriceRule> & { cadenceMinutes: number }) | null {
  let best: (Versioned<PricingConsolePriceRule> & { cadenceMinutes: number }) | null = null
  for (const row of policy.prices.values()) {
    if (row.value.unit !== 'area-month') continue
    const c = row.value.cadenceMinutes
    if (c > cadenceMinutes) continue
    if (best === null || c > best.cadenceMinutes) best = { ...row, cadenceMinutes: c }
  }
  return best
}

/**
 * The best live offer on `item` for this user: made for them, for everyone, or for their plan,
 * started and not ended at `now`. The largest discount wins; ties go to the lower key.
 */
export function bestOffer(
  policy: Policy,
  item: PricingConsoleItem,
  userId: string,
  plan: string | null,
  now: Date,
): Versioned<PricingConsoleOffer> | null {
  let best: Versioned<PricingConsoleOffer> | null = null
  const t = now.getTime()
  for (const row of policy.offers.values()) {
    const o = row.value
    if (o.item !== item) continue
    if (Date.parse(o.startsAt) > t || Date.parse(o.endsAt) <= t) continue
    const forUser =
      o.userId === userId || o.segment === 'all' || (plan !== null && o.segment === `plan:${plan}`)
    if (!forUser) continue
    if (
      best === null ||
      o.discountBps > best.value.discountBps ||
      (o.discountBps === best.value.discountBps && row.key < best.key)
    ) {
      best = row
    }
  }
  return best
}

export const versionOf = (kind: string, row: { key: string; version: number }) =>
  `${kind}/${row.key}@${row.version}`

export interface Priced {
  list: number
  amount: number
  offer: Versioned<PricingConsoleOffer> | null
  floored: boolean
}

/**
 * A checking or watching price for one user: the list price, less the best offer, never below
 * the floor price at the lowest rate credit is sold at (costs can rise after a price is set).
 */
export function priceCredits(
  policy: Policy,
  s: Settings,
  costs: Costs,
  rule: PricingConsolePriceRule,
  offer: Versioned<PricingConsoleOffer> | null,
): Priced {
  const list = rule.credits
  const offered = offer ? discounted(list, offer.value.discountBps) : list
  let min = rule.unit === 'area-month' ? 1 : 0
  const cost = unitCost(rule, costs)
  if (cost === undefined) min = Number.MAX_SAFE_INTEGER
  else if (cost !== null) {
    const low = lowestRate(listRateSources(policy, s))
    min =
      low === null ? Number.MAX_SAFE_INTEGER : Math.max(1, floorCredits(low, cost, s.minMarginBps))
  }
  if (offered >= min) return { list, amount: offered, offer, floored: false }
  if (list >= min) return { list, amount: min, offer, floored: true }
  return { list, amount: min, offer: null, floored: true }
}

/**
 * A plan fee for one user: the list fee less the best offer, unless the offer would leave the
 * plan's credits earning less than the dearest checking action needs; then the list fee.
 */
export function pricePlan(
  policy: Policy,
  s: Settings,
  costs: Costs,
  tier: PricingConsoleTier,
  period: 'monthly' | 'yearly',
  offer: Versioned<PricingConsoleOffer> | null,
): Priced | null {
  const list = period === 'monthly' ? tier.monthlyPriceMinor : tier.yearlyPriceMinor
  if (list === null) return null
  if (!offer) return { list, amount: list, offer: null, floored: false }
  const amount = discounted(list, offer.value.discountBps)
  if (tier.bundledCredits === 0) return { list, amount, offer, floored: false }
  const r = planRate(amount, tier.bundledCredits, period === 'monthly' ? 1 : 12, s)
  for (const { value: rule } of policy.prices.values()) {
    const cost = unitCost(rule, costs)
    if (cost === null || cost === undefined || rule.unit !== 'each') continue
    if (!covers(r, rule.credits, cost, s.minMarginBps)) {
      return { list, amount: list, offer: null, floored: true }
    }
  }
  return { list, amount, offer, floored: false }
}

/**
 * Credits for a top-up of `netCashMinor` (what the payment left Nabvy) at the tier's net top-up
 * rate, with the largest discount among the packs whose own net price it reaches. Rounded down.
 */
export function topupCredits(
  policy: Policy,
  s: Settings,
  tier: Versioned<PricingConsoleTier>,
  netCashMinor: number,
): { credits: number; pack: Versioned<PricingConsoleBundle> | null } {
  let pack: Versioned<PricingConsoleBundle> | null = null
  for (const row of policy.bundles.values()) {
    const b = row.value
    if (b.tier !== null && b.tier !== tier.key) continue
    if (netOfGrossMinor(b.grossMinor, s) > netCashMinor) continue
    if (pack === null || b.discountBps > pack.value.discountBps) pack = row
  }
  const d = pack?.value.discountBps ?? 0
  const credits =
    (BigInt(netCashMinor) * BigInt(MICROS_PER_PENNY) * BigInt(BPS)) /
    (BigInt(tier.value.topupNetMicrosPerCredit) * BigInt(BPS - d))
  return { credits: Number(credits), pack: d > 0 ? pack : null }
}
