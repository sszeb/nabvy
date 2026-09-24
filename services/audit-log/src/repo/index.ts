// Database access. Own tables from '@nabvy/db/schema/audit-log'; other modules only through
// their v_ views (packages/db/README.md). User rows only inside withUser.
import type { AuditLogListInput } from '@nabvy/contracts/modules/audit-log'
import type { Queryable } from '@nabvy/db'
import { entries, vEntries } from '@nabvy/db/schema/audit-log'
import { and, desc, eq, lt, type SQL } from 'drizzle-orm'
import type { EntryRow } from '../domain'

/** Inserts one row. No RETURNING: writers have no select grant, so the id is made in code. */
export async function insertEntry(q: Queryable, row: EntryRow): Promise<void> {
  await q.insert(entries).values({
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    target: row.target,
    before: row.before,
    after: row.after,
    reason: row.reason,
  })
}

/** A row of `v_entries` with its time as an ISO string; `listEntries` parses it. */
export type EntryViewRow = Omit<typeof vEntries.$inferSelect, 'at'> & { at: string }

/** A page of `v_entries`, newest first. Needs a role that may read the view. */
export async function selectEntries(
  q: Queryable,
  input: AuditLogListInput,
): Promise<EntryViewRow[]> {
  const where: SQL[] = []
  if (input.before) where.push(lt(vEntries.at, new Date(input.before)))
  if (input.actorUserId) where.push(eq(vEntries.actorUserId, input.actorUserId))
  if (input.target) where.push(eq(vEntries.target, input.target))
  const rows = await q
    .select()
    .from(vEntries)
    .where(and(...where))
    .orderBy(desc(vEntries.at), desc(vEntries.id))
    .limit(input.limit)
  return rows.map((row) => ({ ...row, at: row.at.toISOString() }))
}
