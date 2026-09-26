import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the migrations of this module and of every module it reads
// applied in dependency order (module.json `dependsOn`), so the tests run the real views, grants,
// policies and cross-module SQL. Upstream rows are seeded straight into the upstream modules' own
// tables as the migration superuser, as asking-price-index's tests do; the module itself runs as
// nabvy_pipeline. copy-advert (read by asking-price-index) builds a pg_trgm index, so pg_trgm is
// loaded. The full migration set runs on real Postgres in `pnpm db:dry-run`
// (packages/db/tests/warning-signs.test.sql).

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const migrations = join(root, 'packages/db/migrations')

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
  /** Runs `fn` in one transaction as `role`. The transaction commits unless `fn` throws. */
  as<T>(role: Role, fn: (tx: Queryable) => Promise<T>): Promise<T>
  /** Runs SQL as the migration superuser. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Runs SQL as `role` in its own transaction. */
  sqlAs(role: Role, query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite({ extensions: { pg_trgm } })
  await pg.exec('set search_path = "$user", public, extensions')
  for (const file of [
    join(root, 'supabase/tests/supabase-stubs.sql'),
    ...sqlIn(join(root, 'supabase/migrations')),
    ...ordered(['audit-log', 'warning-signs']).flatMap((m) => sqlIn(join(migrations, m))),
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
    async sqlAs(role, query, params = []) {
      return pg.transaction(async (tx) => {
        if (role !== 'postgres') await tx.exec(`set local role ${role}`)
        return (await tx.query<Record<string, unknown>>(query, params)).rows
      })
    },
    close: () => pg.close(),
  }
}

/** Sets a switch, as the migration superuser (mirrors an admin change). */
export async function setSwitch(
  db: TestDatabase,
  state: 'off' | 'shadow' | 'on',
  name = 'warning-signs',
): Promise<void> {
  await db.sql(
    `insert into switches.switches (name, kind, state) values ($2, $3, $1)
     on conflict (name) do update set state = excluded.state`,
    [state, name, name === 'pipeline' ? 'global' : 'module'],
  )
}

/** The switches this module reads, and the modules whose views it reads. */
export const UPSTREAM = [
  'pipeline',
  'listing-ingest',
  'detail-evidence',
  'listing-assessment',
  'asking-price-index',
  'listing-suppression',
  'quote-redaction',
]

export async function switchOn(db: TestDatabase, names: string[]): Promise<void> {
  for (const name of names) await setSwitch(db, 'on', name)
}

/** One index group the listing's ask belongs to. */
export interface SeedGroup {
  key: string
  median: number
  n: number
  counted?: boolean
  excluded?: string | null
}

/** One synthetic listing, seeded through the upstream modules' own tables. */
export interface SeedListing {
  id: string
  title?: string
  description?: string | null
  descriptionStatus?: 'full_verified' | 'partial' | 'missing'
  priceMinor?: number
  /** Omit for no assessment of the version. */
  cautions?: string[]
  exclusions?: { partType: string; seq: number | null }[]
  groups?: SeedGroup[]
  /** Distinguishes versions of one listing (a new evidence hash). */
  version?: number
  /** Distinguishes cards of one listing (a new card hash). */
  card?: number
}

const hex = (n: number) => n.toString(16).padStart(64, '0')
const seedIndex = new Map<string, number>()

/**
 * Seeds (or replaces) each listing's card, current detail version, assessment and index group
 * memberships, as the migration superuser.
 */
export async function seed(db: TestDatabase, listings: SeedListing[]): Promise<void> {
  for (const l of listings) {
    const n = seedIndex.get(l.id) ?? seedIndex.size + 1
    seedIndex.set(l.id, n)
    const evidence = hex(n * 1000 + (l.version ?? 0))
    const card = hex(10_000_000 + n * 1000 + (l.card ?? 0))
    const status = l.descriptionStatus ?? 'full_verified'
    const description = l.description === undefined ? 'Works well, collection only.' : l.description
    await db.sql(
      `insert into listing_ingest.listings (id, source, source_listing_id, card_hash, title,
         first_fetched_at, last_seen_at, availability, item_job_id, item_seq, price_minor, currency,
         money_kind, binding, city_page_id, found_by_terms)
       values ($1, 'facebook', $2, $3, $4, '2026-09-25T12:00:00Z', '2026-09-25T12:00:00Z', 'live',
         1, $5, $6, 'GBP', 'fixed', 'verified', null, '{3090}')
       on conflict (id) do update set card_hash = excluded.card_hash, title = excluded.title,
         price_minor = excluded.price_minor`,
      [l.id, `fb-${n}`, card, l.title ?? 'RTX 3090', n, l.priceMinor ?? 50_000],
    )
    await db.sql(
      `insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
         first_seen_at, last_seen_at, item_job_id, item_seq, title, description, description_status)
       values ('facebook', $1, $2, $3, now(), now(), 1, $4, $5, $6, $7)
       on conflict do nothing`,
      [`fb-${n}`, l.id, evidence, n, l.title ?? 'RTX 3090', description, status],
    )
    await db.sql(
      `insert into detail_evidence.fetches (source, source_listing_id, job_id, seq, fetched_at,
         listing_id, evidence_hash, description_status)
       values ('facebook', $1, $2, $3, now(), $4, $5, $6)
       on conflict do nothing`,
      [`fb-${n}`, 1 + (l.version ?? 0) + (l.card ?? 0) * 100, n, l.id, evidence, status],
    )
    if (l.cautions !== undefined || l.exclusions !== undefined) {
      await db.sql(
        `insert into listing_assessment.assessments (listing_id, evidence_hash, card_hash,
           record_hash, rule_version, form, container, container_reason, gpu_state, coverage,
           cautions, exclusions, assessed_at)
         values ($1, $2, $3, $2, 'a1.00000000', 'part', false, 'placed', 'named', '{}', $4, $5,
           now())
         on conflict do nothing`,
        [
          l.id,
          evidence,
          card,
          JSON.stringify(l.cautions ?? []),
          JSON.stringify(
            (l.exclusions ?? []).map((e) => ({
              ...e,
              source: 'description',
              quote: 'no gpu',
              start: 0,
              end: 6,
            })),
          ),
        ],
      )
    }
    await db.sql('delete from asking_price_index.members where listing_id = $1', [l.id])
    for (const g of l.groups ?? []) {
      await db.sql(
        `insert into asking_price_index.groups (group_key, catalogue_id, context, condition,
           country, currency, window_days, label)
         values ($1, 'gpu:rtx-3090', 'standalone', 'used_good', 'GB', 'GBP', 30, 'RTX 3090')
         on conflict do nothing`,
        [g.key],
      )
      await db.sql(
        `insert into asking_price_index.stats (group_key, n, median, thin, copy_collapse, as_of)
         values ($1, $2, $3, false, false, '2026-09-25T12:00:00Z')
         on conflict (group_key) do update set n = excluded.n, median = excluded.median,
           as_of = excluded.as_of + interval '1 second'`,
        [g.key, g.n, g.median],
      )
      await db.sql(
        `insert into asking_price_index.members (group_key, listing_id, ask_minor, counted,
           excluded, sample_origin, collapse_key, seen_at, card_hash, evidence_hash)
         values ($1, $2::uuid, $3, $4, $5, 'on_target', $2::text, now(), $6, $7)`,
        [
          g.key,
          l.id,
          l.priceMinor ?? 50_000,
          g.counted ?? true,
          g.excluded ?? null,
          card,
          evidence,
        ],
      )
    }
  }
}

/** The facts `v_facts` shows, per listing ID, as `code` or `code:reason`, sorted. */
export async function observe(db: TestDatabase): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const r of await db.sqlAs(
    'nabvy_pipeline',
    'select listing_id, code, reason from warning_signs.v_facts',
  )) {
    const id = r.listing_id as string
    const list = out[id] ?? []
    list.push(r.reason ? `${r.code}:${r.reason}` : (r.code as string))
    out[id] = list.sort()
  }
  return out
}
