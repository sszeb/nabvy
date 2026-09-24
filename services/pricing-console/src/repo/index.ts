// Database access to the pricing_console schema, and the measured-cost reader over
// cost_meter.v_costs. Times compare with the database's `now()`, never the caller's clock.
import {
  PricingConsoleBundle,
  PricingConsoleCostBasis,
  PricingConsoleFreeTier,
  type PricingConsoleKind,
  PricingConsoleOffer,
  PricingConsolePriceRule,
  PricingConsoleSetting,
  PricingConsoleSettingKey,
  PricingConsoleTier,
} from '@nabvy/contracts/modules/pricing-console'
import type { Queryable } from '@nabvy/db'
import { policyRows } from '@nabvy/db/schema/pricing-console'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { type Costs, emptyPolicy, floorCost, type Policy } from '../domain'

export type PolicyRow = typeof policyRows.$inferSelect
export type NewPolicyRow = typeof policyRows.$inferInsert

/**
 * Serialises policy writes until the transaction ends, so a change is checked against the floor
 * with no other change landing between the check and the insert.
 */
export async function lockPolicy(q: Queryable): Promise<void> {
  await q.execute(sql`select pg_advisory_xact_lock(hashtextextended('pricing-console:policy', 0))`)
}

export async function dbNow(q: Queryable): Promise<Date> {
  const result = await q.execute<{ now: string | Date }>(sql`select now() as now`)
  const row = result.rows[0]
  if (!row) throw new Error('pricing-console: no time from the database')
  return new Date(row.now)
}

interface CurrentRow {
  kind: string
  key: string
  version: number
  value: Record<string, unknown>
}

/** Each (kind, key)'s highest version in effect, retired ones left out; RLS applies. */
async function currentRows(q: Queryable): Promise<CurrentRow[]> {
  const rows = await q
    .selectDistinctOn([policyRows.kind, policyRows.key], {
      kind: policyRows.kind,
      key: policyRows.key,
      version: policyRows.version,
      value: policyRows.value,
      retired: policyRows.retired,
    })
    .from(policyRows)
    .where(sql`${policyRows.effectiveAt} <= now()`)
    .orderBy(policyRows.kind, policyRows.key, desc(policyRows.version))
  return rows.filter((r) => !r.retired)
}

/**
 * The current policy. Every row was validated when it was written; one that no longer parses
 * stops the read (fail closed) rather than being priced from a guess.
 */
export async function loadPolicy(q: Queryable): Promise<Policy> {
  const policy = emptyPolicy()
  for (const r of await currentRows(q)) {
    const row = <T>(value: T) => ({ key: r.key, version: r.version, value })
    switch (r.kind as PricingConsoleKind) {
      case 'setting':
        policy.settings.set(
          PricingConsoleSettingKey.parse(r.key),
          row(PricingConsoleSetting.parse(r.value)),
        )
        break
      case 'tier':
        policy.tiers.set(r.key, row(PricingConsoleTier.parse(r.value)))
        break
      case 'price':
        policy.prices.set(r.key, row(PricingConsolePriceRule.parse(r.value)))
        break
      case 'bundle':
        policy.bundles.set(r.key, row(PricingConsoleBundle.parse(r.value)))
        break
      case 'offer':
        policy.offers.set(r.key, row(PricingConsoleOffer.parse(r.value)))
        break
      case 'cost-basis':
        policy.costBases.set(r.key, row(PricingConsoleCostBasis.parse(r.value)))
        break
      case 'free-tier':
        policy.freeTier = row(PricingConsoleFreeTier.parse(r.value))
        break
    }
  }
  return policy
}

/** The floor's cost per basis: the higher of the measured mean and the recorded fallback. */
export async function loadCosts(q: Queryable, policy: Policy): Promise<Costs> {
  const costs = new Map<string, number>()
  for (const { key, value: b } of policy.costBases.values()) {
    const result = await q.execute<{ cost: string | number | null }>(
      sql`select pricing_console.measured_cost(${b.provider}, ${b.module}::text, ${b.windowDays}::integer, ${b.minSamples}::integer) as cost`,
    )
    const cost = result.rows[0]?.cost
    const measured = cost === null || cost === undefined ? null : Number(cost)
    costs.set(key, floorCost(b, measured))
  }
  return costs
}

export async function latestVersion(
  q: Queryable,
  kind: PricingConsoleKind,
  key: string,
): Promise<PolicyRow | undefined> {
  const [row] = await q
    .select()
    .from(policyRows)
    .where(and(eq(policyRows.kind, kind), eq(policyRows.key, key)))
    .orderBy(desc(policyRows.version))
    .limit(1)
  return row
}

export async function insertRow(q: Queryable, row: NewPolicyRow): Promise<PolicyRow> {
  const [inserted] = await q.insert(policyRows).values(row).returning()
  if (!inserted) throw new Error('pricing-console: policy row not written')
  return inserted
}

/** Deletes offers made for these users (account deletion). Returns how many went. */
export async function deleteOffersFor(q: Queryable, userIds: readonly string[]): Promise<number> {
  if (userIds.length === 0) return 0
  const gone = await q
    .delete(policyRows)
    .where(and(isNotNull(policyRows.targetUserId), inArray(policyRows.targetUserId, [...userIds])))
    .returning({ id: policyRows.id })
  return gone.length
}
