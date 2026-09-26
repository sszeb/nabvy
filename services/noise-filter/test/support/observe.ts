import type { TestDatabase } from './database'

type Json = Record<string, unknown>

/**
 * What a case checks, per source listing ID, as `v_classifications` gives it: the reason codes,
 * and every found-by term as `<term>:<status>`.
 */
export async function observe(t: TestDatabase): Promise<Record<string, Json>> {
  const listings: Record<string, Json> = {}
  for (const c of await t.asPipeline(
    `select l.source_listing_id as sid, c.reasons, c.terms
     from noise_filter.v_classifications c join listing_ingest.v_listings l on l.id = c.listing_id`,
  )) {
    listings[c.sid as string] = {
      reasons: c.reasons,
      terms: (c.terms as Json[]).map((x) => `${x.term}:${x.status}`),
    }
  }
  return listings
}
