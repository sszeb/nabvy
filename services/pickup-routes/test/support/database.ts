import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { PickupRoutesPoint } from '@nabvy/contracts/modules/pickup-routes'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'
import type { PickupRoutesDeps } from '../../src/index'

// An in-process Postgres (PGlite) with the real migrations of every module this module's writes
// touch: core, audit-log, switches, better-auth (account standing, through @nabvy/account's
// isActive), then pickup-routes. Built like listing-feedback's test support: `as(role, fn,
// userId)` runs a transaction as nabvy_app or nabvy_pipeline, the way withUser and withPipeline
// do. The full set runs on real Postgres in `pnpm db:dry-run` (packages/db/tests/
// pickup-routes.test.sql). The geocoder is injected: location is never called in these tests.

const migrations = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url))

function migrationFiles(module: string): string[] {
  const dir = join(migrations, module)
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

export type Role = 'postgres' | 'nabvy_app' | 'nabvy_pipeline'

export interface TestDatabase {
  as<T>(role: Role, fn: (tx: Queryable) => Promise<T>, userId?: string): Promise<T>
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

const SUPABASE_STUBS = fileURLToPath(
  new URL('../../../../supabase/tests/supabase-stubs.sql', import.meta.url),
)

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite()
  for (const file of [
    SUPABASE_STUBS,
    ...migrationFiles('core'),
    ...migrationFiles('audit-log'),
    ...migrationFiles('switches'),
    ...migrationFiles('better-auth'),
    ...migrationFiles('pickup-routes'),
  ]) {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^create extension /i.test(line))
      .join('\n')
      .replaceAll('--> statement-breakpoint', '')
    await pg.exec(text)
  }
  const db = drizzle(pg)
  return {
    async as(role, fn, userId) {
      return db.transaction(async (tx) => {
        if (role !== 'postgres') await tx.execute(`set local role ${role}`)
        if (userId) await tx.execute(`select set_config('app.user_id', '${userId}', true)`)
        return fn(tx as unknown as Queryable)
      })
    },
    async sql(query, params = []) {
      return (await pg.query<Record<string, unknown>>(query, params)).rows
    },
    close: () => pg.close(),
  }
}

/** Registers a user in better_auth, the way better_auth.account_active() needs to find them. */
export async function seedUser(db: TestDatabase, userId: string, email: string): Promise<void> {
  await db.sql(
    `insert into better_auth."user" (id, name, email) values ($1, $2, $3) on conflict (id) do nothing`,
    [userId, email, email],
  )
}

export async function setSwitch(db: TestDatabase, value: 'off' | 'shadow' | 'on'): Promise<void> {
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('pickup-routes', 'module', $1)
     on conflict (name) do update set state = excluded.state`,
    [value],
  )
}

/** A fixed 32-byte test key (never a real one). */
export const TEST_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'

/** Postcodes around Chichester, resolved without location or postcodes.io. */
export const POSTCODES: Record<string, PickupRoutesPoint> = {
  'PO19 1AA': { lat: 50.8365, lng: -0.7792 }, // Chichester (home)
  'PO21 1AA': { lat: 50.7825, lng: -0.6746 }, // Bognor Regis
  'PO1 1AA': { lat: 50.7989, lng: -1.0912 }, // Portsmouth
  'RH20 1AA': { lat: 50.9573, lng: -0.5133 }, // Pulborough
  'PO18 1AA': { lat: 50.8801, lng: -0.9058 }, // Emsworth-ish
  'BN17 1AA': { lat: 50.8095, lng: -0.5405 }, // Littlehampton
  'GU29 1AA': { lat: 50.9848, lng: -0.7364 }, // Midhurst
}

export const deps = (extra: Partial<PickupRoutesDeps> = {}): PickupRoutesDeps => ({
  dataKey: TEST_KEY,
  geocode: async (_q, postcode) => POSTCODES[postcode.trim().toUpperCase()],
  now: new Date('2026-09-25T12:00:00.000Z'),
  ...extra,
})

export const U1 = '0190f1d2-0000-7000-8000-000000000001'
export const U2 = '0190f1d2-0000-7000-8000-000000000002'
export const DAY = '2026-09-26'
