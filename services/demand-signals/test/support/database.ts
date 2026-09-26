import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) in the order the live project gets its migrations: Supabase
// stand-ins, supabase/migrations (the gateway bootstrap), then every module this one reads and
// what those need, then this module. Built like listing-assessment's test support. Used as
// nabvy_pipeline, the role the module runs as. PGlite has no pg_net, PostGIS or pgvector, so
// their `create extension` lines are skipped; pg_trgm is loaded (copy-advert's index needs it).
// The full set runs on real Postgres in `pnpm db:dry-run`.
//
// Inputs are seeded straight into the owning modules' tables as the migration superuser: the
// module reads only their views, so the seed exercises exactly the SQL it runs in production.

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const sqlIn = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(root, dir, name))

const FILES = [
  join(root, 'supabase/tests/supabase-stubs.sql'),
  ...sqlIn('supabase/migrations'),
  ...[
    'core',
    'audit-log',
    'switches',
    'account',
    'subscriptions',
    'cost-meter',
    'apify-gateway',
    'listing-ingest',
    'detail-evidence',
    'product-catalogue',
    'parts-rules',
    'spend-governor',
    'details-queue',
    'quote-redaction',
    'parts-ai',
    'parts-record',
    'listing-assessment',
    'run-coverage',
    'city-pages',
    'want-manager',
    'listing-suppression',
    'copy-advert',
    'demand-signals',
  ].flatMap((m) => sqlIn(`packages/db/migrations/${m}`)),
]

export type SwitchState = 'off' | 'shadow' | 'on'

/** Every module this one reads, on; this module in shadow (its default once enabled). */
export const INPUTS_ON: Record<string, SwitchState> = {
  'want-manager': 'on',
  'listing-ingest': 'on',
  'listing-assessment': 'on',
  'parts-record': 'on',
  'city-pages': 'on',
  'copy-advert': 'on',
  'demand-signals': 'shadow',
}

export interface WantSeed {
  centreId: string
  /** The criterion's catalogue ID; its family is the catalogue ID while product-catalogue is off. */
  catalogueId: string
  count: number
}

export interface AdvertSeed {
  /** The listing's city page: a centre's own page, whose nearest centre is that centre. */
  cityPageId: string
  catalogueIds: string[]
  listedAt: string | null
  firstFetchedAt?: string
  kind?: 'wanted_or_swap' | 'pc' | 'laptop' | 'not_a_pc'
  /** A copy-advert cluster the listing is an active member of. */
  clusterKey?: string
}

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as nabvy_pipeline. */
  asPipeline(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs `fn` in one transaction, as a pipeline task's `withPipeline` does. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  switches(states: Record<string, SwitchState>): Promise<void>
  /** Two active centres from city-pages' seeded grid, as [A, B]. */
  centres(): Promise<[string, string]>
  /** `count` active wants at a centre, each of a different user; returns the user IDs. */
  wants(seed: WantSeed): Promise<string[]>
  /** One listing with its parts record and assessment (and cluster membership); its ID. */
  advert(seed: AdvertSeed): Promise<string>
  close(): Promise<void>
}

const hex = (s: string) => createHash('sha256').update(s).digest('hex')
let seq = 0

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite({ extensions: { pg_trgm } })
  // As copy-advert's test support: roles are emulated with `set role` on one connection, which
  // does not reapply the core migration's per-role search_path, so pg_trgm's operators (in
  // `extensions`) are put on the session's path once here.
  await pg.exec('set search_path = "$user", public, extensions')
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line) || /pg_trgm/i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  await pg.exec('set role nabvy_pipeline')
  const asOwner = async (query: string, params: unknown[] = []) => {
    await pg.exec('reset role')
    try {
      return (await pg.query<Record<string, unknown>>(query, params)).rows
    } finally {
      await pg.exec('set role nabvy_pipeline')
    }
  }
  const db = drizzle(pg)
  const clusters = new Set<string>()

  return {
    db: db as unknown as Queryable,
    sql: asOwner,
    asPipeline: async (query, params = []) =>
      (await pg.query<Record<string, unknown>>(query, params)).rows,
    transaction: (fn) => db.transaction((tx) => fn(tx as unknown as Queryable)),
    async switches(states) {
      for (const [name, value] of Object.entries(states)) {
        await asOwner(
          `insert into switches.switches (name, kind, state) values ($1, 'module', $2)
           on conflict (name) do update set state = excluded.state`,
          [name, value],
        )
      }
    },
    async centres() {
      const rows = await asOwner(
        `select c.city_page_id from city_pages.centres c
         join city_pages.city_pages p on p.city_page_id = c.city_page_id
         where c.active and p.lat is not null order by c.city_page_id limit 2`,
      )
      return [String(rows[0]?.city_page_id), String(rows[1]?.city_page_id)]
    },
    async wants({ centreId, catalogueId, count }) {
      const users: string[] = []
      for (let i = 0; i < count; i++) {
        const userId = randomUUID()
        users.push(userId)
        const [w] = await asOwner(
          `insert into want_manager.wants (user_id, lat, lng, radius_km, centre_id, currency,
             cadence_seconds, delivery_methods, version_hash)
           values ($1, 51.5, -0.1, 50, $2, 'GBP', 900, array['collection'], $3) returning id`,
          [userId, centreId, hex(`want-${++seq}`)],
        )
        await asOwner(
          `insert into want_manager.criteria (want_id, user_id, position, part_type, catalogue_id)
           values ($1, $2, 0, 'gpu', $3)`,
          [w?.id, userId, catalogueId],
        )
      }
      return users
    },
    async advert(seed) {
      const n = ++seq
      const evidenceHash = hex(`evidence-${n}`)
      const fetched = seed.firstFetchedAt ?? seed.listedAt ?? '2026-09-01T00:00:00Z'
      const [l] = await asOwner(
        `insert into listing_ingest.listings (source, source_listing_id, card_hash, title,
           listed_at, first_fetched_at, last_seen_at, availability, item_job_id, item_seq,
           city_page_id)
         values ('facebook', $1, $2, 'WANTED', $3, $4, $4, 'live', 1, $5, $6) returning id`,
        [`${1_000_000 + n}`, hex(`card-${n}`), seed.listedAt, fetched, n, seed.cityPageId],
      )
      const listingId = String(l?.id)
      await asOwner(
        `insert into parts_record.records (listing_id, evidence_hash, rule_version, part_count,
           kind, kind_by)
         values ($1, $2, 'r1.00000000', $3, $4, 'rules')`,
        [listingId, evidenceHash, seed.catalogueIds.length, seed.kind ?? 'wanted_or_swap'],
      )
      const parts = seed.catalogueIds.map((catalogueId, i) => ({
        seq: i,
        partType: 'gpu',
        catalogueId,
        extractor: 'rules',
        source: 'title',
        quote: 'WANTED',
        start: 0,
        end: 6,
      }))
      await asOwner(
        `insert into listing_assessment.assessments (listing_id, evidence_hash, record_hash,
           rule_version, form, container, container_reason, gpu_state, coverage, confirmed_parts,
           assessed_at)
         values ($1, $2, $3, 'a1.00000000', 'part', false, 'placed', 'named', '{}'::jsonb, $4::jsonb,
           now())`,
        [listingId, evidenceHash, hex(`record-${n}`), JSON.stringify(parts)],
      )
      if (seed.clusterKey) {
        if (!clusters.has(seed.clusterKey)) {
          clusters.add(seed.clusterKey)
          await asOwner(
            `insert into copy_advert.clusters (cluster_key, rule_version, member_set_hash,
               listing_count, town_count, span_days, mass_posted, status, as_of)
             values ($1, 'c1', $2, 2, 2, 1, false, 'active', now())`,
            [seed.clusterKey, hex(`cluster-${seed.clusterKey}`)],
          )
        }
        await asOwner(
          `insert into copy_advert.members (cluster_key, listing_id, source_listing_id,
             city_page_id, basis, joined_at)
           values ($1, $2, $3, $4, 'exact_text', now())`,
          [seed.clusterKey, listingId, `${1_000_000 + n}`, seed.cityPageId],
        )
      }
      return listingId
    },
    close: () => pg.close(),
  }
}
