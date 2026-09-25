// Public API of the pricing-console module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/pricing-console' only, never from its internals.
//
// Every price is a versioned policy row read live on each call, so a change applies on the next
// read (well within the minute the brief allows) with no deploy and no cache to expire. Every
// function runs on the caller's transaction (`q`).
import { record } from '@nabvy/audit-log'
import { err, ok, type Result } from '@nabvy/contracts'
import {
  module,
  PRICING_CONSOLE_MESSAGES,
  type PricingConsoleError,
  type PricingConsoleErrorCode,
  type PricingConsoleEstimate,
  PricingConsoleEstimateInput,
  type PricingConsolePolicyRow,
  PricingConsolePriceForInput,
  type PricingConsoleQuote,
  PricingConsoleRetireInput,
  PricingConsoleSetInput,
} from '@nabvy/contracts/modules/pricing-console'
import type { UsageLedgerPolicyQuote } from '@nabvy/contracts/modules/usage-ledger'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import type { UsageLedgerPolicy } from '@nabvy/usage-ledger'
import {
  bestOffer,
  floorViolations,
  newViolations,
  type Policy,
  planItem,
  priceCredits,
  pricePlan,
  settingsOf,
  topupCredits,
  type Versioned,
  type Violation,
  versionOf,
  watchPriceFor,
} from './domain'
import * as repo from './repo'

export { events, module } from '@nabvy/contracts/modules/pricing-console'
export { accountDeletedHandler } from './handlers'

const refuse = (
  code: PricingConsoleErrorCode,
  violations?: string[],
): Result<never, PricingConsoleError> =>
  err({
    code,
    message: PRICING_CONSOLE_MESSAGES[code],
    ...(violations ? { violations } : {}),
  })

const PREFIX = 'pricing-console:'

// ---------------------------------------------------------------------------------------------
// Reads: prices, the estimate, the usage-ledger policy
// ---------------------------------------------------------------------------------------------

/**
 * The price of one item for one user now: a checking or watching action in credits
 * (`price:<key>`), or a plan fee in gross pence (`plan:<tier>:monthly|yearly`). The best live
 * offer for the user applies while the module is `on` (off or shadow: list prices, no offers).
 * Never below the floor: if measured cost has risen past a price, the floor price is returned
 * and `floored` is set. `plan` is the user's plan, for plan-segment offers (null: none apply).
 */
export async function priceFor(
  q: Queryable,
  input: PricingConsolePriceForInput,
): Promise<Result<PricingConsoleQuote, PricingConsoleError>> {
  const p = PricingConsolePriceForInput.parse(input)
  const policy = await repo.loadPolicy(q)
  const s = settingsOf(policy)
  if ('missing' in s) return refuse('pricing-console.not_found')
  const costs = await repo.loadCosts(q, policy)
  const offer = await liveOffer(q, policy, p.item, p.userId, p.plan)
  const plan = planItem(p.item)
  if (plan) {
    const tier = policy.tiers.get(plan.tier)
    const priced = tier && pricePlan(policy, s, costs, tier.value, plan.period, offer)
    if (!tier || !priced) return refuse('pricing-console.not_found')
    return ok(quote(p.item, 'gbp-minor', priced, versionOf('tier', tier)))
  }
  const rule = policy.prices.get(p.item.slice('price:'.length))
  if (!rule) return refuse('pricing-console.not_found')
  const priced = priceCredits(policy, s, costs, rule.value, offer)
  if (!priced) return refuse('pricing-console.no_price')
  return ok(quote(p.item, 'credits', priced, versionOf('price', rule)))
}

function quote(
  item: PricingConsoleQuote['item'],
  currency: PricingConsoleQuote['currency'],
  priced: NonNullable<ReturnType<typeof priceCredits>>,
  rowVersion: string,
): PricingConsoleQuote {
  return {
    item,
    currency,
    list: priced.list,
    amount: priced.amount,
    offer: priced.offer?.key ?? null,
    floored: priced.floored,
    policyVersion:
      PREFIX +
      [rowVersion, priced.offer && versionOf('offer', priced.offer)].filter(Boolean).join('+'),
  }
}

/** The best offer that applies now, only while the module is `on`. */
async function liveOffer(
  q: Queryable,
  policy: Policy,
  item: PricingConsoleQuote['item'],
  userId: string,
  plan: string | null,
) {
  if ((await state(q, module)) !== 'on') return null
  return bestOffer(policy, item, userId, plan, await repo.dbNow(q))
}

/**
 * The monthly credit estimate for a want before it is saved (the want screen and the cadence
 * slider): nothing when the cadence is at or slower than the plan's base (the fee funds it);
 * refused when faster than the plan's floor; otherwise the watching price of the nearest priced
 * cadence at or faster than the one asked for, per area, times the areas (round the clock
 * multiplies it by the `round-the-clock-bps` setting). Offers apply as in `priceFor`.
 */
export async function estimate(
  q: Queryable,
  input: PricingConsoleEstimateInput,
): Promise<Result<PricingConsoleEstimate, PricingConsoleError>> {
  const w = PricingConsoleEstimateInput.parse(input)
  const policy = await repo.loadPolicy(q)
  const s = settingsOf(policy)
  const tier = policy.tiers.get(w.plan)
  if ('missing' in s || !tier) return refuse('pricing-console.not_found')
  const t = tier.value
  const base = {
    plan: w.plan,
    cadenceMinutes: w.cadenceMinutes,
    exceedsAreas: w.areaCount > t.areas,
  }
  if (w.cadenceMinutes >= t.baseCadenceMinutes) {
    return ok({
      ...base,
      included: true,
      pricedCadenceMinutes: null,
      creditsPerAreaMonth: 0,
      creditsPerMonth: 0,
      offer: null,
      policyVersion: PREFIX + versionOf('tier', tier),
    })
  }
  if (w.cadenceMinutes < t.floorCadenceMinutes) return refuse('pricing-console.below_plan_floor')
  const rule = watchPriceFor(policy, w.cadenceMinutes)
  if (!rule) return refuse('pricing-console.no_price')
  const costs = await repo.loadCosts(q, policy)
  const offer = await liveOffer(q, policy, `price:${rule.key}`, w.userId, w.plan)
  const priced = priceCredits(policy, s, costs, rule.value, offer)
  if (!priced) return refuse('pricing-console.no_price')
  const perArea = w.roundTheClock
    ? Math.ceil((priced.amount * s.roundTheClockBps) / 10_000)
    : priced.amount
  return ok({
    ...base,
    included: false,
    pricedCadenceMinutes: rule.cadenceMinutes,
    creditsPerAreaMonth: perArea,
    creditsPerMonth: perArea * w.areaCount,
    offer: priced.offer?.key ?? null,
    policyVersion:
      PREFIX +
      [
        versionOf('tier', tier),
        versionOf('price', rule),
        priced.offer && versionOf('offer', priced.offer),
      ]
        .filter(Boolean)
        .join('+'),
  })
}

/**
 * The `UsageLedgerPolicy` usage-ledger values policy grants with (docs/decisions.md, "Paid
 * ladder"): the plan's bundled credits, and a top-up's credits at the tier's net top-up rate
 * with the best pack discount the payment reaches. Answers whatever the module's switch (list
 * prices apply when off), so a paid top-up is never refused for want of a price. `null` when no
 * current row answers for the plan.
 */
export const usageLedgerPolicy: UsageLedgerPolicy = {
  async bundleCredits(q, plan): Promise<UsageLedgerPolicyQuote | null> {
    const tier = (await repo.loadPolicy(q)).tiers.get(plan)
    if (!tier || tier.value.bundledCredits < 1) return null
    return { credits: tier.value.bundledCredits, policyVersion: PREFIX + versionOf('tier', tier) }
  },
  async topupCredits(q, plan, cashMinor): Promise<UsageLedgerPolicyQuote | null> {
    const policy = await repo.loadPolicy(q)
    const s = settingsOf(policy)
    const tier = policy.tiers.get(plan)
    if (!tier || 'missing' in s) return null
    const { credits, pack } = topupCredits(policy, s, tier, cashMinor)
    if (credits < 1 || credits > 2_147_483_647) return null
    const versions = [versionOf('tier', tier), pack && versionOf('bundle', pack)]
    return { credits, policyVersion: PREFIX + versions.filter(Boolean).join('+') }
  },
}

/** What the floor refuses in the current policy (the admin screen's warnings; normally none). */
export async function checkFloor(q: Queryable): Promise<Violation[]> {
  const policy = await repo.loadPolicy(q)
  return floorViolations(policy, await repo.loadCosts(q, policy))
}

// ---------------------------------------------------------------------------------------------
// Admin writes
// ---------------------------------------------------------------------------------------------

export interface Changed {
  row: PricingConsolePolicyRow
  /** False when the value equals the current version's: nothing was written. */
  changed: boolean
}

function toRow(r: repo.PolicyRow): PricingConsolePolicyRow {
  return {
    id: r.id,
    kind: r.kind as PricingConsolePolicyRow['kind'],
    key: r.key,
    version: r.version,
    value: r.value as PricingConsolePolicyRow['value'],
    retired: r.retired,
    effectiveAt: r.effectiveAt.toISOString(),
    createdBy: r.createdBy,
    reason: r.reason,
  }
}

/** Structural equality of two JSON values (jsonb reorders object keys). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return (
    ka.length === kb.length &&
    ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  )
}

/** The policy with one row replaced (or removed, for a retirement). */
function withChange(
  policy: Policy,
  kind: PricingConsoleSetInput['kind'],
  key: string,
  value: unknown,
): Policy {
  const next: Policy = {
    settings: new Map(policy.settings),
    tiers: new Map(policy.tiers),
    prices: new Map(policy.prices),
    bundles: new Map(policy.bundles),
    offers: new Map(policy.offers),
    costBases: new Map(policy.costBases),
    freeTier: policy.freeTier,
  }
  const row = (v: unknown) => ({ key, version: 0, value: v }) as Versioned<never>
  const maps = {
    setting: next.settings,
    tier: next.tiers,
    price: next.prices,
    bundle: next.bundles,
    offer: next.offers,
    'cost-basis': next.costBases,
  } as const
  if (kind === 'free-tier') {
    next.freeTier = value === null ? null : row(value)
    return next
  }
  const map = maps[kind] as Map<string, Versioned<unknown>>
  if (value === null) map.delete(key)
  else map.set(key, row(value))
  return next
}

/**
 * Writes the next version of one policy row, refused (`pricing-console.below_floor`, with each
 * breach) if it would newly sell anything below measured cost times the minimum margin, and
 * records one `pricing-console.policy-changed` audit row in the same transaction (an audit
 * failure rolls the change back). Takes effect at `effectiveAt` (now if omitted), read live by
 * every caller. Idempotent: the current value again writes nothing.
 *
 * Runs in the pipeline (`withPipeline`): the admin procedure checks the session's admin role on
 * the server first (`requireAdmin` from @nabvy/auth); the database has no admin check for the web
 * app role (README.md, "Inputs"). Refused while the module is off.
 */
export async function setPolicy(
  q: Queryable,
  input: PricingConsoleSetInput,
): Promise<Result<Changed, PricingConsoleError>> {
  const parsed = PricingConsoleSetInput.safeParse(input)
  if (!parsed.success) {
    return refuse(
      'pricing-console.invalid',
      parsed.error.issues.map((i) => i.message),
    )
  }
  const c = parsed.data
  return write(q, c.actorUserId, c.kind, c.key, c.value, c.effectiveAt, c.reason, false)
}

/**
 * Withdraws a tier, price, bundle or offer: a new version marked retired, checked against the
 * floor and audited like `setPolicy`. Retiring what is already retired writes nothing.
 */
export async function retirePolicy(
  q: Queryable,
  input: PricingConsoleRetireInput,
): Promise<Result<Changed, PricingConsoleError>> {
  const parsed = PricingConsoleRetireInput.safeParse(input)
  if (!parsed.success) {
    return refuse(
      'pricing-console.invalid',
      parsed.error.issues.map((i) => i.message),
    )
  }
  const c = parsed.data
  return write(q, c.actorUserId, c.kind, c.key, null, undefined, c.reason, true)
}

async function write(
  q: Queryable,
  actorUserId: string,
  kind: PricingConsoleSetInput['kind'],
  key: string,
  value: Record<string, unknown> | null,
  effectiveAt: string | undefined,
  reason: string | undefined,
  retire: boolean,
): Promise<Result<Changed, PricingConsoleError>> {
  if ((await state(q, module)) === 'off') return refuse('pricing-console.off')
  await repo.lockPolicy(q)
  const now = await repo.dbNow(q)
  if (effectiveAt !== undefined && Date.parse(effectiveAt) < now.getTime()) {
    return refuse('pricing-console.invalid', ['a change cannot take effect in the past'])
  }
  if (kind === 'offer' && value && Date.parse(String(value.endsAt)) <= now.getTime()) {
    return refuse('pricing-console.invalid', ['the offer has already ended'])
  }

  const latest = await repo.latestVersion(q, kind, key)
  if (retire && !latest) return refuse('pricing-console.not_found')
  if (latest && latest.retired === retire && (retire || sameJson(latest.value, value))) {
    return ok({ row: toRow(latest), changed: false })
  }
  // A version never takes effect before the one it follows, so a change made now cannot skip
  // a version already scheduled: without a time it follows that version (review of PR #55).
  const scheduled = latest && latest.effectiveAt > now ? latest.effectiveAt : null
  const at = effectiveAt === undefined ? (scheduled ?? now) : new Date(effectiveAt)
  if (scheduled && at < scheduled) {
    return refuse('pricing-console.invalid', [
      `version ${latest?.version} takes effect at ${scheduled.toISOString()}; a change cannot take effect before it`,
    ])
  }
  // An offer stays with whom it was made for: one user, or its segment (review of PR #55).
  if (kind === 'offer' && latest && value && (value.userId ?? null) !== latest.targetUserId) {
    return refuse('pricing-console.invalid', [
      'an offer cannot change whom it is for; make a new offer instead',
    ])
  }

  const before = await repo.loadPolicy(q)
  const after = withChange(before, kind, key, value)
  const costsBefore = await repo.loadCosts(q, before)
  const costsAfter =
    kind === 'cost-basis' ? await repo.loadCosts(q, after, { unwritten: true }) : costsBefore
  const fresh = newViolations(
    floorViolations(before, costsBefore),
    floorViolations(after, costsAfter),
    `${kind}/${key}`,
  )
  if (fresh.length > 0) {
    return refuse(
      'pricing-console.below_floor',
      fresh.map((v) => v.message),
    )
  }

  const stored = value ?? latest?.value ?? {}
  const inserted = await repo.insertRow(q, {
    kind,
    key,
    version: (latest?.version ?? 0) + 1,
    value: stored,
    retired: retire,
    targetUserId: kind === 'offer' ? ((stored.userId as string | null) ?? null) : null,
    // Omitted: the database's now(), the same clock the views compare with.
    ...(effectiveAt === undefined && !scheduled ? {} : { effectiveAt: at }),
    createdBy: actorUserId,
    reason: reason ?? null,
  })
  await record(q, {
    actorUserId,
    action: retire ? 'pricing-console.policy-retired' : 'pricing-console.policy-changed',
    target: `policy:${kind}/${key}`,
    before: latest
      ? { version: latest.version, value: latest.value, retired: latest.retired }
      : undefined,
    after: {
      version: inserted.version,
      value: inserted.value,
      retired: inserted.retired,
      effectiveAt: inserted.effectiveAt.toISOString(),
    },
    reason,
  } as Parameters<typeof record>[1])
  return ok({ row: toRow(inserted), changed: true })
}

/** Deletes offers made for these users (account deletion, rule 12). Idempotent. */
export async function purge(q: Queryable, userIds: readonly string[]): Promise<number> {
  return repo.deleteOffersFor(q, userIds)
}

export type { Violation } from './domain'
