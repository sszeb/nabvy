import type { TestDatabase } from './database'

type Json = Record<string, unknown>

/**
 * What a case checks, per source listing ID, as `v_assessments` and `v_unknowns` give it: the
 * record's kind, `container` as `<true|false>:<reason>`, the form, the GPU state, the cautions,
 * the coverage as the parts read (`title`, `description`, `photos`), every confirmed part as
 * `<part type>:<source>:<quote>`, every exclusion as `<part type>:<source>:<quote>`, the bundle
 * extras as `<item>:<source>:<quote>`, and the unknown part types.
 */
export async function observe(t: TestDatabase): Promise<Record<string, Json>> {
  const listings: Record<string, Json> = {}
  for (const a of await t.asPipeline(
    `select l.source_listing_id as sid, a.kind, a.form, a.container, a.container_reason,
            a.gpu_state, a.cautions, a.coverage, a.confirmed_parts, a.exclusions, a.extras
     from listing_assessment.v_assessments a join listing_ingest.v_listings l on l.id = a.listing_id`,
  )) {
    const evidence = (rows: unknown, head: string) =>
      (rows as Json[]).map((r) => `${r[head]}:${r.source}:${r.quote}`)
    const coverage = a.coverage as Record<string, boolean>
    listings[a.sid as string] = {
      kind: a.kind,
      container: `${a.container}:${a.container_reason}`,
      form: a.form,
      gpu: a.gpu_state,
      cautions: a.cautions,
      coverage: Object.keys(coverage).filter((k) => coverage[k]),
      confirmed: evidence(a.confirmed_parts, 'partType'),
      exclusions: evidence(a.exclusions, 'partType'),
      extras: evidence(a.extras, 'item'),
      unknowns: [],
    }
  }
  for (const u of await t.asPipeline(
    `select l.source_listing_id as sid, u.part_type
     from listing_assessment.v_unknowns u join listing_ingest.v_listings l on l.id = u.listing_id
     order by u.part_type`,
  )) {
    ;(listings[u.sid as string]?.unknowns as string[] | undefined)?.push(u.part_type as string)
  }
  return listings
}
