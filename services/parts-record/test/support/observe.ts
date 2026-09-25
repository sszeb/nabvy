import type { TestDatabase } from './database'

type Json = Record<string, unknown>

/**
 * What a case checks, per source listing ID: the record's kind (`<by>:<kind>[:<source>:<quote>]`
 * or `gap:<reason>`), its extractor versions as present or not, whether it conflicts, and every
 * part as `v_parts` gives it: `<extractor>:<source>:<part type>:<quote>[ → <catalogue ID>]
 * [<inclusion>][ !conflict][ (rejected)]`, in seq order.
 */
export async function observe(t: TestDatabase): Promise<Record<string, Json>> {
  const listings: Record<string, Json> = {}
  const of = (sid: string) => {
    listings[sid] ??= { parts: [] }
    return listings[sid] as { parts: string[] } & Json
  }
  for (const r of await t.asPipeline(
    `select l.source_listing_id as sid, r.kind, r.kind_gap, r.kind_by, r.kind_source, r.kind_quote,
            r.rule_version, r.ai_version, r.photo_version, r.parts, r.conflict
     from parts_record.v_records r join listing_ingest.v_listings l on l.id = r.listing_id`,
  )) {
    const o = of(r.sid as string)
    o.kind = r.kind
      ? `${r.kind_by}:${r.kind}${r.kind_quote ? `:${r.kind_source}:${r.kind_quote}` : ''}`
      : `gap:${r.kind_gap}`
    o.versions = {
      rules: /^r\d+\./.test(String(r.rule_version)),
      ai: r.ai_version ? /^p\d+\./.test(String(r.ai_version)) : null,
      photo: r.photo_version ?? null,
    }
    o.conflict = r.conflict
    o.count = r.parts
  }
  for (const p of await t.asPipeline(
    `select l.source_listing_id as sid, p.extractor, p.source, p.part_type, p.quote,
            p.catalogue_id, p.inclusion, p.conflict, p.rejected
     from parts_record.v_parts p join listing_ingest.v_listings l on l.id = p.listing_id
     order by p.seq`,
  )) {
    of(p.sid as string).parts.push(
      `${p.extractor}:${p.source}:${p.part_type}:${p.quote}${
        p.catalogue_id ? ` → ${p.catalogue_id}` : ''
      } [${p.inclusion}]${p.conflict ? ' !conflict' : ''}${p.rejected ? ' (rejected)' : ''}`,
    )
  }
  return listings
}
