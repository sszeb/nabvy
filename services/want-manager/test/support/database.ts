import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { LocationPoint } from '@nabvy/contracts/modules/location'
import type { WantManagerUpsertWantInput } from '@nabvy/contracts/modules/want-manager'
import type { Queryable } from '@nabvy/db'
import { drizzle } from 'drizzle-orm/pglite'
import type { WantManagerDeps } from '../../src/index'

// An in-process Postgres (PGlite) with the real migrations of every module this module's writes
// and views touch: core, audit-log, switches, better-auth (account standing through
// @nabvy/account's isActive), account (v_standing: the fair-use cap), usage-ledger and
// subscriptions (v_entitlements: the paid flag and the tier's want count), product-catalogue
// (v_items: a catalogue ID's family), city-pages (v_centres, v_city_pages, haversine_km: the
// nearest centre), then want-manager. Built like listing-feedback's test support: `as(role, fn,
// userId)` runs a transaction as nabvy_app or nabvy_pipeline, the way withUser and withPipeline
// do. The full set runs on real Postgres in `pnpm db:dry-run` (packages/db/tests/
// want-manager.test.sql).

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
  /** Runs `fn` in one transaction as `role`; with `userId`, as withUser does. */
  as<T>(role: Role, fn: (tx: Queryable) => Promise<T>, userId?: string): Promise<T>
  /** Runs SQL as the migration superuser. */
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
    ...migrationFiles('account'),
    ...migrationFiles('usage-ledger'),
    ...migrationFiles('subscriptions'),
    ...migrationFiles('product-catalogue'),
    ...migrationFiles('city-pages'),
    ...migrationFiles('want-manager'),
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
    `insert into better_auth."user" (id, name, email) values ($1, $2, $3)
     on conflict (id) do nothing`,
    [userId, email, email],
  )
}

export async function setSwitches(
  db: TestDatabase,
  states: Record<string, 'off' | 'shadow' | 'on'>,
): Promise<void> {
  for (const [name, value] of Object.entries(states)) {
    await db.sql(
      `insert into switches.switches (name, kind, state) values ($1, 'module', $2)
       on conflict (name) do update set state = excluded.state`,
      [name, value],
    )
  }
}

export const ALL_ON = {
  'want-manager': 'on',
  location: 'on',
  'city-pages': 'on',
  subscriptions: 'on',
  'product-catalogue': 'on',
} as const

/** A city page with a seed coordinate and an active centre on it. */
export async function seedCentre(
  db: TestDatabase,
  input: { cityPageId: string; lat: number; lng: number; verified?: boolean; active?: boolean },
): Promise<void> {
  await db.sql(
    `insert into city_pages.city_pages (city_page_id, name, lat, lng, coord_source, first_seen_at)
     values ($1, $1, $2, $3, 'seed', now()) on conflict (city_page_id) do nothing`,
    [input.cityPageId, input.lat, input.lng],
  )
  await db.sql(
    `insert into city_pages.centres (city_page_id, active, verified, country, currency, area_km)
     values ($1, $2, $3, 'GB', 'GBP', 100) on conflict (city_page_id) do nothing`,
    [input.cityPageId, input.active ?? true, input.verified ?? false],
  )
}

/** A paid or free entitlement row for the user. */
export async function seedEntitlement(
  db: TestDatabase,
  input: { userId: string; status: 'free' | 'trialing' | 'active' | 'past_due'; wants: number },
): Promise<void> {
  await db.sql(
    `insert into subscriptions.entitlements
       (user_id, tier, status, areas, wants, channels, last_event_id, last_event_at)
     values ($1, $2, $3, 1, $4, '{telegram}', 'evt_test', now())
     on conflict (user_id) do update set status = excluded.status, wants = excluded.wants, tier = excluded.tier`,
    [input.userId, input.status === 'free' ? 'free' : 'pro', input.status, input.wants],
  )
}

/** A fair-use limit on the user's standing (account-integrity's doing). */
export async function seedFairUse(
  db: TestDatabase,
  userId: string,
  maxActiveHunts: number,
): Promise<void> {
  await db.sql(
    `insert into account.standing (user_id, status, limits) values ($1, 'active', $2::jsonb)
     on conflict (user_id) do update set limits = excluded.limits`,
    [userId, JSON.stringify({ maxActiveHunts })],
  )
}

/** A catalogue item, so a criterion's catalogue ID resolves to a family. */
export async function seedCatalogueItem(
  db: TestDatabase,
  input: { catalogueId: string; kind: 'gpu' | 'cpu'; family: string; name: string },
): Promise<void> {
  await db.sql(
    `insert into product_catalogue.items (catalogue_id, kind, family, name) values ($1, $2, $3, $4)
     on conflict (catalogue_id) do nothing`,
    [input.catalogueId, input.kind, input.family, input.name],
  )
}

// Points the fake postcode lookup knows. Chichester and Redhill are the two centres the tests
// seed; the postcodes are illustrative, never looked up.
export const POINTS: Record<string, LocationPoint> = {
  PO191AA: { lat: 50.8367, lng: -0.7792 },
  RH11AA: { lat: 51.2403, lng: -0.171 },
}

export const CHICHESTER = { cityPageId: 'chichester', lat: 50.8367, lng: -0.7792 }
export const REDHILL = { cityPageId: 'redhill', lat: 51.2403, lng: -0.171 }

/** The injected ports: a postcode table instead of postcodes.io, no listing-search preview. */
export const testDeps: WantManagerDeps = {
  pointForPostcode: async (_q, postcode) => POINTS[postcode.replace(/\s+/g, '').toUpperCase()],
}

export const wantInput = (
  userId: string,
  overrides: Partial<WantManagerUpsertWantInput> = {},
): WantManagerUpsertWantInput => ({
  userId,
  postcode: 'PO19 1AA',
  radiusKm: 25,
  priceCapMinor: 250000,
  currency: 'GBP',
  active: true,
  cadenceSeconds: 300,
  deliverySpeed: 'instant',
  deliveryMethods: ['collection'],
  alternatives: 'variants_plus_tier',
  pcContainment: false,
  alternativesMaxPriceMinor: null,
  instantAlternatives: false,
  instantTopPicks: true,
  filter: null,
  criteria: [
    { partType: 'gpu', catalogueId: 'gpu:rtx-4080', family: null, minAttr: null, orBetter: true },
    {
      partType: 'ram',
      catalogueId: null,
      family: null,
      minAttr: { sizeGb: 32, generation: 'ddr5' },
      orBetter: false,
    },
  ],
  ...overrides,
})
