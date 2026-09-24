import type { Queryable } from '@nabvy/db'
import { providerCalls } from '@nabvy/db/schema/cost-meter'
import { and, asc, eq, gte, isNull } from 'drizzle-orm'
import type { LedgerInsert, LedgerRow, SettlementPatch } from '../domain'

// Database access to the module's own table, cost_meter.provider_calls. Pipeline only: run
// inside withPipeline (nabvy_pipeline). Other modules read cost_meter.v_costs, never this table.

/**
 * Inserts a call unless (provider, ref_id) is already recorded; either way returns the stored
 * row. A replay therefore writes nothing.
 */
export async function insertCall(
  db: Queryable,
  values: LedgerInsert,
): Promise<{ row: LedgerRow; created: boolean }> {
  const inserted = await db
    .insert(providerCalls)
    .values(values)
    .onConflictDoNothing({ target: [providerCalls.provider, providerCalls.refId] })
    .returning()
  if (inserted[0]) return { row: inserted[0], created: true }
  const existing = await findCall(db, values.provider, values.refId)
  if (!existing)
    throw new Error(`cost-meter: ${values.provider} ${values.refId} vanished on insert`)
  return { row: existing, created: false }
}

export async function findCall(
  db: Queryable,
  provider: string,
  refId: string,
): Promise<LedgerRow | undefined> {
  const rows = await db
    .select()
    .from(providerCalls)
    .where(and(eq(providerCalls.provider, provider), eq(providerCalls.refId, refId)))
    .limit(1)
  return rows[0]
}

/**
 * Writes a settlement only while the row is unsettled, so two settlers racing cannot both win.
 * Returns undefined when another settlement got there first; the caller re-reads and decides.
 */
export async function writeSettlement(
  db: Queryable,
  id: string,
  patch: SettlementPatch,
): Promise<LedgerRow | undefined> {
  const rows = await db
    .update(providerCalls)
    .set(patch)
    .where(and(eq(providerCalls.id, id), isNull(providerCalls.settledAt)))
    .returning()
  return rows[0]
}

/** Calls at or after `since`, oldest first, optionally for one module. */
export async function listCalls(
  db: Queryable,
  filter: { since: Date; module?: string },
): Promise<LedgerRow[]> {
  const conditions = [gte(providerCalls.at, filter.since)]
  if (filter.module) conditions.push(eq(providerCalls.module, filter.module))
  return db
    .select()
    .from(providerCalls)
    .where(and(...conditions))
    .orderBy(asc(providerCalls.at), asc(providerCalls.id))
}
