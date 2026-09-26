import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'

// An in-process Postgres (PGlite) with the migrations up to listing-assessment, in the order the
// live project gets them (as listing-assessment's own test support loads them), so the tests read
// the real v_assessments and v_unknowns, with their switch filter and grants, as nabvy_pipeline.
// The module owns no tables: tests seed listing_assessment.assessments as the migration
// superuser, with rows built from listing-assessment's recorded fixtures (each case's notes.md).
// `create extension` lines are skipped, and a stand-in `extensions.similarity` keeps
// product-catalogue's migration loading, as in listing-assessment's support.

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
  ].flatMap((m) => sqlIn(`packages/db/migrations/${m}`)),
]

export type SwitchState = 'off' | 'shadow' | 'on'

/** One assessment row, in the compact form of listing-assessment's expected.json. */
export interface SeedAssessment {
  /** The source listing ID the row is built from; the listing and hashes derive from it. */
  key: string
  /** A second version of the same listing: a different evidence hash. */
  version?: number
  form: string
  container: boolean
  containerReason: string
  gpuState: string
  /** `partType:source:quote`, in the record's order. */
  confirmed: string[]
  unknowns: string[]
  assessedAt: string
  correction?: Record<string, unknown>
}

export interface TestDatabase {
  /** Drizzle on the one PGlite connection, running as nabvy_pipeline. */
  db: Queryable
  /** Runs SQL as the migration superuser, then returns to the pipeline role. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  switches(states: Record<string, SwitchState>): Promise<void>
  seed(rows: SeedAssessment[]): Promise<void>
  close(): Promise<void>
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

/** The synthetic listing UUID for a source listing ID (stable across runs). */
export function listingIdOf(key: string): string {
  const h = sha(`listing:${key}`)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export const evidenceHashOf = (key: string, version = 1) => sha(`evidence:${key}:${version}`)

export const ALL_ON: Record<string, SwitchState> = {
  'prepared-message': 'on',
  'listing-assessment': 'on',
  'quote-redaction': 'on',
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  await pg.exec(`create schema if not exists extensions;
    create function extensions.similarity(text, text) returns real
      language sql immutable as 'select 0::real';
    grant usage on schema extensions to public;`)
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
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
  return {
    db: drizzle(pg) as unknown as Queryable,
    sql: asOwner,
    async switches(states) {
      for (const [name, state] of Object.entries(states)) {
        await asOwner(
          `insert into switches.switches (name, kind, state) values ($1, 'module', $2)
           on conflict (name) do update set state = excluded.state`,
          [name, state],
        )
      }
    },
    async seed(rows) {
      for (const row of rows) {
        const confirmed = row.confirmed.map((entry, seq) => {
          const [partType, source, ...rest] = entry.split(':')
          const quote = rest.join(':')
          return {
            seq,
            partType,
            catalogueId: null,
            extractor: 'rules',
            source,
            quote,
            start: 0,
            end: quote.length,
          }
        })
        await asOwner(
          `insert into listing_assessment.assessments
             (listing_id, evidence_hash, record_hash, rule_version, form, container,
              container_reason, gpu_state, coverage, confirmed_parts, unknowns, assessed_at,
              correction)
           values ($1, $2, $3, 'a1.0123abcd', $4, $5, $6, $7,
                   '{"title": true, "fullDescription": true, "photos": false}', $8, $9, $10, $11)`,
          [
            listingIdOf(row.key),
            evidenceHashOf(row.key, row.version),
            sha(`record:${row.key}:${row.version ?? 1}`),
            row.form,
            row.container,
            row.containerReason,
            row.gpuState,
            JSON.stringify(confirmed),
            JSON.stringify(row.unknowns),
            row.assessedAt,
            row.correction ? JSON.stringify(row.correction) : null,
          ],
        )
      }
    },
    close: () => pg.close(),
  }
}
