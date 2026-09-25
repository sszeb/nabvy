// Database access to the location schema only. Other modules never read this table directly:
// pointForPostcode() (src/index.ts) is the only way anything gets a postcode's coordinates
// (packages/db/README.md).
import type { Queryable } from '@nabvy/db'
import { postcodeCache } from '@nabvy/db/schema/location'
import { eq } from 'drizzle-orm'

export interface CachedPoint {
  lat: number
  lng: number
}

/** The cached point for a normalised postcode, if this module has resolved it before. */
export async function selectCachedPostcode(
  q: Queryable,
  postcode: string,
): Promise<CachedPoint | undefined> {
  const [row] = await q
    .select({ lat: postcodeCache.lat, lng: postcodeCache.lng })
    .from(postcodeCache)
    .where(eq(postcodeCache.postcode, postcode))
  return row
}

/**
 * Caches a postcode's point. Idempotent: a postcode already cached by a concurrent lookup keeps
 * its first result rather than racing to overwrite it (the same coordinate either way).
 */
export async function insertCachedPostcode(
  q: Queryable,
  row: { postcode: string; lat: number; lng: number },
): Promise<void> {
  await q.insert(postcodeCache).values(row).onConflictDoNothing()
}
