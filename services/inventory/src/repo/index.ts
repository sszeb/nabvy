// Database access to the inventory schema, and reads of other modules' views (packages/db/
// README.md). Runs as nabvy_app inside withUser (packages/db/migrations/inventory/*_access.sql):
// row-level security limits every statement to the caller's own rows. The purge runs as the
// pipeline.
import { InventoryItem } from '@nabvy/contracts/modules/inventory'
import type { Queryable } from '@nabvy/db'
import { items, vInventoryItems } from '@nabvy/db/schema/inventory'
import { desc, inArray, sql } from 'drizzle-orm'

export type ItemRow = typeof items.$inferSelect

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

const ITEM_COLUMNS = sql`id, user_id as "userId", product_key as "productKey",
  source_listing_id as "sourceListingId", scan_id as "scanId", currency, cost_minor as "costMinor",
  bought_at as "boughtAt", sold_minor as "soldMinor", sold_at as "soldAt", sold_on as "soldOn",
  sold_recorded_at as "soldRecordedAt", created_at as "createdAt", updated_at as "updatedAt"`

/** Normalises what Postgres returns (bigint as string, date as string or Date) to the row type. */
function normalise(row: Record<string, unknown>): ItemRow {
  return {
    ...(row as ItemRow),
    costMinor: Number(row.costMinor),
    soldMinor: row.soldMinor == null ? null : Number(row.soldMinor),
    boughtAt: dateString(row.boughtAt) as string,
    soldAt: dateString(row.soldAt),
    soldRecordedAt: row.soldRecordedAt == null ? null : new Date(String(row.soldRecordedAt)),
  }
}

const dateString = (value: unknown): string | null => {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

export interface NewItem {
  id: string
  userId: string
  productKey: string | null
  sourceListingId: string | null
  scanId: string | null
  currency: string
  costMinor: number
  boughtAt: string
}

/**
 * Inserts the item under the client's ID. A conflict on the ID writes nothing (`on conflict do
 * nothing`), and the caller then reads the row back through RLS to tell a resubmitted form (the
 * same item, the user's own) from a clash with another user's ID or a different item.
 */
export async function insertItem(q: Queryable, item: NewItem): Promise<ItemRow | null> {
  const result = await q.execute(sql`
    insert into inventory.items
      (id, user_id, product_key, source_listing_id, scan_id, currency, cost_minor, bought_at)
    values (${item.id}, ${item.userId}, ${item.productKey}, ${item.sourceListingId}, ${item.scanId},
            ${item.currency}, ${item.costMinor}, ${item.boughtAt}::date)
    on conflict (id) do nothing
    returning ${ITEM_COLUMNS}
  `)
  const [row] = rowsOf<Record<string, unknown>>(result)
  return row ? normalise(row) : null
}

/** The caller's own item by ID, or null (another user's row is invisible under RLS). */
export async function findItem(q: Queryable, itemId: string): Promise<ItemRow | null> {
  const result = await q.execute(
    sql`select ${ITEM_COLUMNS} from inventory.items where id = ${itemId}`,
  )
  const [row] = rowsOf<Record<string, unknown>>(result)
  return row ? normalise(row) : null
}

/** Sets or replaces the sale on the caller's own item. `recordedAt` is server time. */
export async function setSale(
  q: Queryable,
  itemId: string,
  sale: { soldMinor: number; soldAt: string; soldOn: string | null; recordedAt: Date },
): Promise<ItemRow | null> {
  const result = await q.execute(sql`
    update inventory.items
    set sold_minor = ${sale.soldMinor}, sold_at = ${sale.soldAt}::date, sold_on = ${sale.soldOn},
        sold_recorded_at = ${sale.recordedAt.toISOString()}::timestamptz
    where id = ${itemId}
    returning ${ITEM_COLUMNS}
  `)
  const [row] = rowsOf<Record<string, unknown>>(result)
  return row ? normalise(row) : null
}

/** Whether this listing is on the listing card the caller can see (`app.v_listing_card`). */
export async function listingOnCard(q: Queryable, listingId: string): Promise<boolean> {
  const result = await q.execute(
    sql`select 1 as one from app.v_listing_card where listing_id = ${listingId}`,
  )
  return rowsOf(result).length > 0
}

/**
 * The caller's own scan (`scan_recognition.v_user_scans`, RLS-scoped, rows only while
 * scan-recognition is on) with what it identified, or null when it is not theirs.
 */
export async function userScan(
  q: Queryable,
  scanId: string,
): Promise<{ identified: string | null } | null> {
  const result = await q.execute(
    sql`select identified from scan_recognition.v_user_scans where id = ${scanId}`,
  )
  const [row] = rowsOf<{ identified: string | null }>(result)
  return row ? { identified: row.identified ?? null } : null
}

/** The caller's own items from `app.v_inventory_items`, newest purchase first. */
export async function selectItems(q: Queryable): Promise<InventoryItem[]> {
  const rows = await q
    .select()
    .from(vInventoryItems)
    .orderBy(desc(vInventoryItems.boughtAt), desc(vInventoryItems.id))
  return rows.map((row) =>
    InventoryItem.parse({
      ...row,
      costMinor: Number(row.costMinor),
      soldMinor: row.soldMinor == null ? null : Number(row.soldMinor),
      profitMinor: row.profitMinor == null ? null : Number(row.profitMinor),
      boughtAt: dateString(row.boughtAt),
      soldAt: dateString(row.soldAt),
    }),
  )
}

/** Deletes every item of these users (account.deleted, rule 12). Idempotent. */
export async function deleteUsersItems(q: Queryable, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await q.delete(items).where(inArray(items.userId, userIds))
}
