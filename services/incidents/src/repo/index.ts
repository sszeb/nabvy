// Database access. Own tables from '@nabvy/db/schema/incidents'; other modules only through
// their v_ views (packages/db/README.md). This module has no user rows, so no withUser scoping.
import type { AppError, EventEnvelope } from '@nabvy/contracts'
import type { IncidentRow } from '@nabvy/contracts/modules/incidents'
import type { Queryable } from '@nabvy/db'
import { incidents } from '@nabvy/db/schema/incidents'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DeadLetterRow } from '../domain'

type Row = typeof incidents.$inferSelect

function toIncidentRow(row: Row): IncidentRow {
  return {
    id: row.id,
    eventType: row.eventType,
    eventKey: row.eventKey,
    payload: row.payload as EventEnvelope,
    error: row.error as AppError,
    attempts: row.attempts,
    firstFailedAt: row.firstFailedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Upserts on `event_key` (the table's unique key): a first failure inserts a row; a replay of the
 * same call, or a fresh failure after a retry, overwrites it and reopens it (`resolved_at` reset
 * to null). This is what makes `record()` idempotent (CLAUDE.md, "Idempotent handlers").
 */
export async function upsertOpen(db: Queryable, row: DeadLetterRow): Promise<IncidentRow> {
  const [saved] = await db
    .insert(incidents)
    .values(row)
    .onConflictDoUpdate({
      target: incidents.eventKey,
      set: {
        eventType: row.eventType,
        payload: row.payload,
        error: row.error,
        attempts: row.attempts,
        firstFailedAt: row.firstFailedAt,
        resolvedAt: null,
        updatedAt: sql`now()`,
      },
    })
    .returning()
  if (!saved) throw new Error('incidents: upsert returned no row')
  return toIncidentRow(saved)
}

export async function findById(db: Queryable, id: string): Promise<IncidentRow | undefined> {
  const [row] = await db.select().from(incidents).where(eq(incidents.id, id))
  return row ? toIncidentRow(row) : undefined
}

/** Marks an incident resolved. Returns `undefined` if it was already resolved (or missing). */
export async function markResolved(
  db: Queryable,
  id: string,
  resolvedAt: Date,
): Promise<IncidentRow | undefined> {
  const [row] = await db
    .update(incidents)
    .set({ resolvedAt, updatedAt: sql`now()` })
    .where(and(eq(incidents.id, id), isNull(incidents.resolvedAt)))
    .returning()
  return row ? toIncidentRow(row) : undefined
}
