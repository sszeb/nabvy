import type { TestDatabase } from './database'

type Json = Record<string, unknown>
type Criterion = {
  kind: string
  partType: string | null
  status: string
  reason: string
  evidence: { source: string }[]
}

/**
 * What a case checks, per want name and source listing ID, as `v_matches` gives it: the verdict,
 * whether the listing sits inside a PC, and every criterion as `<kind or part type>:<status>:
 * <reason>[:<evidence sources>]`. Counts per want: matches, not-stated verdicts, and matches whose
 * matched parts are all quoted from the description (what descriptions add).
 */
export async function observe(
  t: TestDatabase,
  names: Map<string, string>,
): Promise<{ wants: Record<string, Record<string, Json>>; counts: Record<string, Json> }> {
  const wants: Record<string, Record<string, Json>> = {}
  const counts: Record<
    string,
    { matches: number; notStated: number; fromDescriptionOnly: number }
  > = {}
  const rows = await t.asPipeline(
    `select m.want_id, l.source_listing_id as sid, m.verdict, m.inside_pc, m.criteria
     from spec_match.v_matches m join listing_ingest.v_listings l on l.id = m.listing_id
     order by l.source_listing_id`,
  )
  for (const r of rows) {
    const name = names.get(r.want_id as string)
    if (!name) continue
    const criteria = r.criteria as Criterion[]
    wants[name] ??= {}
    ;(wants[name] as Record<string, Json>)[r.sid as string] = {
      verdict: r.verdict,
      insidePc: r.inside_pc,
      criteria: criteria.map((c) => {
        const sources = [...new Set(c.evidence.map((e) => e.source))].sort().join('+')
        return `${c.partType ?? c.kind}:${c.status}:${c.reason}${sources ? `:${sources}` : ''}`
      }),
    }
    counts[name] ??= { matches: 0, notStated: 0, fromDescriptionOnly: 0 }
    const count = counts[name]
    if (r.verdict === 'match') count.matches += 1
    if (r.verdict === 'not_stated') count.notStated += 1
    const matched = criteria.filter((c) => c.kind === 'part' && c.status === 'match')
    if (
      r.verdict !== 'no_match' &&
      matched.length > 0 &&
      matched.every((c) => c.evidence.every((e) => e.source === 'description'))
    ) {
      count.fromDescriptionOnly += 1
    }
  }
  return { wants, counts }
}
