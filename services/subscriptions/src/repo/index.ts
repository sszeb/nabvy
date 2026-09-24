// Database access to the subscriptions schema only. Other modules read v_entitlements and
// v_billing_signals; this file is for services/subscriptions' own use.
import type { Queryable } from '@nabvy/db'
import { billingEvents, customers, entitlements } from '@nabvy/db/schema/subscriptions'
import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm'

export type EntitlementRow = typeof entitlements.$inferSelect
export type NewEntitlement = typeof entitlements.$inferInsert
export type NewBillingEvent = typeof billingEvents.$inferInsert

/** Serialises work on one Stripe event until the transaction ends (a retry racing a delivery). */
export async function lockEvent(q: Queryable, stripeEventId: string): Promise<void> {
  await q.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`subscriptions:${stripeEventId}`}, 0))`,
  )
}

/** Serialises entitlement writes for one user. */
export async function lockUser(q: Queryable, userId: string): Promise<void> {
  await q.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`subscriptions:${userId}`}, 0))`,
  )
}

export async function hasEvent(q: Queryable, stripeEventId: string): Promise<boolean> {
  const [row] = await q
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(eq(billingEvents.stripeEventId, stripeEventId))
  return row !== undefined
}

/** Inserts the event's row; false when its ID is already recorded. */
export async function insertBillingEvent(q: Queryable, row: NewBillingEvent): Promise<boolean> {
  const inserted = await q
    .insert(billingEvents)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: billingEvents.id })
  return inserted.length > 0
}

export async function customerUser(q: Queryable, stripeCustomerId: string): Promise<string | null> {
  const [row] = await q
    .select({ userId: customers.userId })
    .from(customers)
    .where(eq(customers.stripeCustomerId, stripeCustomerId))
  return row?.userId ?? null
}

export async function userCustomer(q: Queryable, userId: string): Promise<string | null> {
  const [row] = await q
    .select({ id: customers.stripeCustomerId })
    .from(customers)
    .where(eq(customers.userId, userId))
    .orderBy(asc(customers.createdAt))
    .limit(1)
  return row?.id ?? null
}

/** Links a customer to a user once; returns the user it is linked to (maybe another). */
export async function linkCustomer(
  q: Queryable,
  stripeCustomerId: string,
  userId: string,
): Promise<string> {
  await q.insert(customers).values({ stripeCustomerId, userId }).onConflictDoNothing()
  return (await customerUser(q, stripeCustomerId)) ?? userId
}

/** The user an earlier charge event recorded, for a dispute (which names only the charge). */
export async function userForCharge(q: Queryable, chargeId: string): Promise<string | null> {
  const [row] = await q
    .select({ userId: billingEvents.userId })
    .from(billingEvents)
    .where(and(eq(billingEvents.stripeObjectId, chargeId), isNotNull(billingEvents.userId)))
    .limit(1)
  return row?.userId ?? null
}

export async function selectEntitlement(
  q: Queryable,
  userId: string,
): Promise<EntitlementRow | undefined> {
  const [row] = await q.select().from(entitlements).where(eq(entitlements.userId, userId))
  return row
}

/** Writes the entitlement; the allowance cash fields are kept (only invoices set them). */
export async function upsertEntitlement(q: Queryable, row: NewEntitlement): Promise<void> {
  const { userId: _userId, periodCashMinor: _cash, cashPeriodStart: _cashStart, ...set } = row
  await q.insert(entitlements).values(row).onConflictDoUpdate({ target: entitlements.userId, set })
}

export async function setPeriodCash(
  q: Queryable,
  userId: string,
  values: {
    periodStart: Date
    periodEnd: Date
    intervalMonths: number
    periodCashMinor: number
  },
): Promise<void> {
  await q
    .update(entitlements)
    .set({ ...values, cashPeriodStart: values.periodStart })
    .where(eq(entitlements.userId, userId))
}

/**
 * Paid entitlements whose current period's cash is known, after `after` in user order: the
 * allowance sweep's batch.
 */
export async function dueAllowances(
  q: Queryable,
  after: string | null,
  limit: number,
): Promise<EntitlementRow[]> {
  return q
    .select()
    .from(entitlements)
    .where(
      and(
        inArray(entitlements.status, ['active', 'trialing']),
        gt(entitlements.periodCashMinor, 0),
        sql`${entitlements.cashPeriodStart} = ${entitlements.periodStart}`,
        sql`${entitlements.periodEnd} > now()`,
        after ? gt(entitlements.userId, after) : undefined,
      ),
    )
    .orderBy(asc(entitlements.userId))
    .limit(limit)
}

export async function deleteEntitlements(
  q: Queryable,
  userIds: readonly string[],
): Promise<number> {
  if (userIds.length === 0) return 0
  const deleted = await q
    .delete(entitlements)
    .where(inArray(entitlements.userId, [...userIds]))
    .returning({ userId: entitlements.userId })
  return deleted.length
}
