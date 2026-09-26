import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { index } from '@nabvy/asking-price-index'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the migrations of this module and of every module it reads
// applied, so the tests exercise the actual tables, grants, policies and cross-module SQL. Asks are
// seeded through the upstream modules' own tables (as asking-price-index's tests do) and grouped by
// the real asking-price-index, whose views this module reads. The full migration set runs on real
// Postgres in `pnpm db:dry-run` (packages/db/tests/asking-price-position.test.sql).

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))
const root = fileURLToPath(new URL('../../../../', import.meta.url))

function sqlIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

/** Modules in dependency order (module.json `dependsOn`), ending with `targets`. */
function ordered(targets: string[]): string[] {
  const out: string[] = []
  const visit = (module: string) => {
    if (out.includes(module)) return
    const deps: string[] =
      module === 'core'
        ? []
        : (JSON.parse(readFileSync(join(migrations, module, 'module.json'), 'utf8')).dependsOn ?? [
            'core',
          ])
    for (const dep of deps) visit(dep)
    out.push(module)
  }
  for (const target of targets) visit(target)
  return out
}

export type Role = 'postgres' | 'nabvy_app' | 'nabvy_pipeline'

export interface TestDatabase {
  pg: PGlite
  /** Runs `fn` in one transaction as `role`; the transaction commits unless `fn` throws. */
  as<T>(role: Role, fn: (tx: Queryable) => Promise<T>): Promise<T>
  /** Runs SQL as the migration superuser. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  // copy-advert's access migration (read by the index) builds a pg_trgm index.
  const pg = new PGlite({ extensions: { pg_trgm } })
  await pg.exec('set search_path = "$user", public, extensions')
  for (const file of [
    join(root, 'supabase/tests/supabase-stubs.sql'),
    ...sqlIn(join(root, 'supabase/migrations')),
    ...ordered(['audit-log', 'asking-price-index', 'asking-price-position']).flatMap((m) =>
      sqlIn(join(migrations, m)),
    ),
  ]) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line) || /pg_trgm/i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  const db = drizzle(pg)
  return {
    pg,
    async as(role, fn) {
      return db.transaction(async (tx) => {
        if (role !== 'postgres') await tx.execute(`set local role ${role}`)
        return fn(tx as unknown as Queryable)
      })
    },
    async sql(query, params = []) {
      return (await pg.query<Record<string, unknown>>(query, params)).rows
    },
    close: () => pg.close(),
  }
}

/** Sets a switch, as the migration superuser (mirrors an admin change). */
export async function setSwitch(
  db: TestDatabase,
  state: 'off' | 'shadow' | 'on',
  name = 'asking-price-position',
): Promise<void> {
  await db.sql(
    `insert into switches.switches (name, kind, state) values ($2, 'module', $1)
     on conflict (name) do update set state = excluded.state`,
    [state, name],
  )
}

/** Every switch the index and this module read, on. */
export const UPSTREAM = [
  'pipeline',
  'listing-ingest',
  'detail-evidence',
  'parts-record',
  'listing-assessment',
  'noise-filter',
  'city-pages',
  'product-catalogue',
  'listing-suppression',
  'asking-price-index',
]

export async function switchOn(db: TestDatabase, names: string[] = UPSTREAM): Promise<void> {
  for (const name of names) await setSwitch(db, 'on', name)
}

/** One synthetic listing, seeded through the upstream modules' own tables. */
export interface SeedListing {
  id: string
  priceMinor: number
  condition?: 'new' | 'used_like_new' | 'used_good' | 'used_fair'
  form?: 'system' | 'bundle' | 'part'
  offered?: string[]
  noise?: boolean
}

const hex = (n: number) => n.toString(16).padStart(64, '0')

/**
 * Seeds a GB centre, the catalogue items and the listings, as the migration superuser. Each
 * listing gets a card, a current detail version, an assessment and a parts record naming
 * `offered` (default one RTX 3090 on its own).
 */
export async function seed(db: TestDatabase, listings: SeedListing[]): Promise<void> {
  await db.pg.exec(`
    insert into city_pages.city_pages (city_page_id, name, coord_source, first_seen_at)
    values ('gb-town', 'GB town', 'seed', now()) on conflict do nothing;
    insert into city_pages.centres (city_page_id, country, currency, area_km)
    values ('gb-town', 'GB', 'GBP', 40) on conflict do nothing;
    insert into product_catalogue.items (catalogue_id, kind, name, family, variant)
    values ('gpu:rtx-3090', 'gpu', 'RTX 3090', 'rtx', '3090'),
           ('gpu:rtx-5080', 'gpu', 'RTX 5080', 'rtx', '5080'),
           ('cpu:9800x3d', 'cpu', 'Ryzen 7 9800X3D', 'ryzen', '9800x3d')
    on conflict do nothing;`)
  for (const [i, l] of listings.entries()) {
    const n = i + 1
    const evidence = hex(n)
    const card = hex(10_000 + n)
    const offered = l.offered ?? ['gpu:rtx-3090']
    await db.sql(
      `insert into listing_ingest.listings (id, source, source_listing_id, card_hash, title,
         first_fetched_at, last_seen_at, availability, item_job_id, item_seq, price_minor, currency,
         money_kind, binding, city_page_id, found_by_terms)
       values ($1, 'facebook', $2, $3, 'Listing', '2026-09-25T12:00:00Z', '2026-09-25T12:00:00Z',
         'live', 1, $4, $5, 'GBP', 'fixed', 'verified', 'gb-town', '{}')`,
      [l.id, `fb-${n}`, card, n, l.priceMinor],
    )
    await db.sql(
      `insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
         first_seen_at, last_seen_at, item_job_id, item_seq, title, description, condition,
         description_status)
       values ('facebook', $1, $2, $3, now(), now(), 1, $4, 'Listing', 'Works well.', $5,
         'full_verified')`,
      [`fb-${n}`, l.id, evidence, n, l.condition ?? 'used_good'],
    )
    await db.sql(
      `insert into detail_evidence.fetches (source, source_listing_id, job_id, seq, fetched_at,
         listing_id, evidence_hash, description_status)
       values ('facebook', $1, 1, $2, now(), $3, $4, 'full_verified')`,
      [`fb-${n}`, n, l.id, evidence],
    )
    await db.sql(
      `insert into listing_assessment.assessments (listing_id, evidence_hash, card_hash, record_hash,
         rule_version, form, container, container_reason, gpu_state, coverage, assessed_at)
       values ($1, $2, $3, $2, 'a1.00000000', $4, false, 'placed', 'named', '{}', now())`,
      [l.id, evidence, card, l.form ?? 'part'],
    )
    const [record] = await db.sql(
      `insert into parts_record.records (listing_id, evidence_hash, rule_version, part_count,
         kind_gap)
       values ($1, $2, 'r1.00000000', $3, 'no_signal') returning id`,
      [l.id, evidence, offered.length],
    )
    for (const [seq, catalogueId] of offered.entries()) {
      await db.sql(
        `insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
           catalogue_id, inclusion, source, extractor, extractor_version, quote, quote_start,
           quote_end)
         values ($1, $2, $3, $4, $5, $6, 'offered', 'title', 'rules', 'r1', 'List', 0, 4)`,
        [record?.id, l.id, evidence, seq, catalogueId.split(':')[0], catalogueId],
      )
    }
    if (l.noise) {
      await db.sql(
        `insert into noise_filter.classifications (listing_id, evidence_hash, input_hash,
           rule_version, classified_at, reasons)
         values ($1, $2, $2, 'n1.00000000', now(), '["wanted"]')`,
        [l.id, evidence],
      )
    }
  }
}

export const NOW = new Date('2026-09-26T00:00:00Z')

/**
 * Runs the real asking-price-index over these listings and returns the group keys it updated,
 * as its `updated` event would carry them.
 */
export async function runIndex(db: TestDatabase, listingIds: string[]): Promise<string[]> {
  const result = await db.as('nabvy_pipeline', (q) => index(q, { listingIds }, { now: NOW }))
  if (!result.ok) throw new Error(result.error.message)
  return result.value.updated
}

/** Rows of the user-facing view, read as the web app. */
export async function shownRows(db: TestDatabase): Promise<Record<string, unknown>[]> {
  return db.as('nabvy_app', async (q) => {
    const result = await q.execute(
      'select * from app.v_asking_price_position order by listing_id, label',
    )
    return (result as unknown as { rows: Record<string, unknown>[] }).rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]),
      ),
    )
  })
}

export const uuid = (i: number) => `01900000-0000-7000-8000-${String(i).padStart(12, '0')}`
