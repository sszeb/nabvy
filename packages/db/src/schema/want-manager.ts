import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the want-manager module, all in the Postgres schema 'want_manager' (packages/db/
// README.md). Only services/want-manager writes them. Other modules import only the views
// (v-prefixed exports). After changing this file: pnpm db:generate want-manager
//
// The vocabularies checked below are the module's contracts (packages/contracts/src/modules/
// want-manager.ts): the cadence ladder, delivery speeds, delivery methods, alternative modes and
// part types. Spelled out here because a check constraint is SQL text, and a contracts test
// (services/want-manager/test/contracts.test.ts) asserts that each list still matches its enum.

export const schema = moduleSchema('want-manager')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })
const list = (values: readonly (string | number)[]) =>
  sql.raw(values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(', '))

export const WANT_MANAGER_CADENCE_STEPS = [14400, 7200, 3600, 1800, 900, 300, 60] as const
export const WANT_MANAGER_DELIVERY_SPEEDS = [
  'instant',
  'batched_15',
  'batched_60',
  'daily',
] as const
export const WANT_MANAGER_DELIVERY_METHODS = ['collection', 'posted'] as const
export const WANT_MANAGER_ALTERNATIVES = ['off', 'variants', 'variants_plus_tier'] as const
export const WANT_MANAGER_PART_TYPES = ['gpu', 'cpu', 'ram', 'storage'] as const
export const WANT_MANAGER_CHANNELS = ['push', 'telegram', 'email'] as const

/**
 * One row per want (docs/design/modules/want-manager.md, "Owns"). The point is the user's
 * postcode's coordinate from `location`; the postcode itself is never stored. `centre_id` is the
 * nearest active city-pages centre with a coordinate (a plain value, no foreign key into another
 * module's schema: rule 4). The per-want alternative and alert controls live here, not in
 * `preferences` (README.md, "Decisions"). Row-level security on `user_id`.
 */
export const wants = schema.table(
  'wants',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    radiusKm: integer('radius_km').notNull(),
    centreId: text('centre_id'),
    centreVerified: boolean('centre_verified').notNull().default(false),
    priceCapMinor: bigint('price_cap_minor', { mode: 'number' }),
    currency: text('currency').notNull(),
    active: boolean('active').notNull().default(true),
    cadenceSeconds: integer('cadence_seconds').notNull(),
    deliverySpeed: text('delivery_speed').notNull().default('instant'),
    deliveryMethods: text('delivery_methods').array().notNull(),
    alternatives: text('alternatives').notNull().default('variants_plus_tier'),
    pcContainment: boolean('pc_containment').notNull().default(false),
    alternativesMaxPriceMinor: bigint('alternatives_max_price_minor', { mode: 'number' }),
    instantAlternatives: boolean('instant_alternatives').notNull().default(false),
    instantTopPicks: boolean('instant_top_picks').notNull().default(true),
    filter: jsonb('filter'),
    /** sha256 of the want's content (services/want-manager/src/domain): the event key's version. */
    versionHash: text('version_hash').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    index('wants_user_id_idx').on(t.userId),
    index('wants_centre_id_idx').on(t.centreId),
    index('wants_active_idx').on(t.active),
    check('wants_lat', sql`${t.lat} between -90 and 90`),
    check('wants_lng', sql`${t.lng} between -180 and 180`),
    check('wants_radius_km', sql`${t.radiusKm} between 1 and 1000`),
    check('wants_currency', sql`${t.currency} in ('GBP', 'EUR')`),
    check('wants_price_cap_minor', sql`${t.priceCapMinor} > 0`),
    check('wants_alternatives_max_price_minor', sql`${t.alternativesMaxPriceMinor} > 0`),
    check(
      'wants_cadence_seconds',
      sql`${t.cadenceSeconds} in (${list(WANT_MANAGER_CADENCE_STEPS)})`,
    ),
    check(
      'wants_delivery_speed',
      sql`${t.deliverySpeed} in (${list(WANT_MANAGER_DELIVERY_SPEEDS)})`,
    ),
    check(
      'wants_delivery_methods',
      sql`cardinality(${t.deliveryMethods}) between 1 and 2 and ${t.deliveryMethods} <@ array[${list(WANT_MANAGER_DELIVERY_METHODS)}]::text[]`,
    ),
    check('wants_alternatives', sql`${t.alternatives} in (${list(WANT_MANAGER_ALTERNATIVES)})`),
    check('wants_version_hash', sql`${t.versionHash} ~ '^[0-9a-f]{64}$'`),
  ],
)

/**
 * One row per spec criterion of a want, in the order the user gave them. Carries `user_id` too so
 * row-level security applies without a join. A catalogue part (`gpu`, `cpu`) names a catalogue ID
 * or a family; a sized part (`ram`, `storage`) carries `min_attr` (size in GB, generation).
 */
export const criteria = schema.table(
  'criteria',
  {
    id: idColumn(),
    wantId: uuid('want_id')
      .notNull()
      .references(() => wants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    position: smallint('position').notNull(),
    partType: text('part_type').notNull(),
    catalogueId: text('catalogue_id'),
    family: text('family'),
    minAttr: jsonb('min_attr'),
    orBetter: boolean('or_better').notNull().default(false),
    ...timestampColumns(),
  },
  (t) => [
    index('criteria_user_id_idx').on(t.userId),
    index('criteria_catalogue_id_idx').on(t.catalogueId),
    uniqueIndex('criteria_want_position_idx').on(t.wantId, t.position),
    check('criteria_position', sql`${t.position} between 0 and 9`),
    check('criteria_part_type', sql`${t.partType} in (${list(WANT_MANAGER_PART_TYPES)})`),
    check(
      'criteria_shape',
      sql`case when ${t.partType} in ('ram', 'storage') then ${t.minAttr} is not null else (${t.catalogueId} is not null or ${t.family} is not null) end`,
    ),
  ],
)

/**
 * One row per user (docs/design/modules/want-manager.md, "Owns": `preferences`): hide flags,
 * channels and quiet hours. Absent means the defaults (services/want-manager/src/domain).
 */
export const preferences = schema.table(
  'preferences',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    hideNoise: boolean('hide_noise').notNull().default(true),
    hideSpam: boolean('hide_spam').notNull().default(true),
    hideMultiQuantity: boolean('hide_multi_quantity').notNull().default(false),
    channels: text('channels').array().notNull().default(sql`'{}'::text[]`),
    quietHours: jsonb('quiet_hours'),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex('preferences_user_id_idx').on(t.userId),
    check(
      'preferences_channels',
      sql`cardinality(${t.channels}) <= 3 and ${t.channels} <@ array[${list(WANT_MANAGER_CHANNELS)}]::text[]`,
    ),
  ],
)

const wantViewColumns = {
  id: uuid('id').notNull(),
  centreId: text('centre_id'),
  radiusKm: integer('radius_km').notNull(),
  priceCapMinor: bigint('price_cap_minor', { mode: 'number' }),
  currency: text('currency').notNull(),
  active: boolean('active').notNull(),
  cadenceSeconds: integer('cadence_seconds').notNull(),
  deliverySpeed: text('delivery_speed').notNull(),
  deliveryMethods: text('delivery_methods').array().notNull(),
  alternatives: text('alternatives').notNull(),
  pcContainment: boolean('pc_containment').notNull(),
  alternativesMaxPriceMinor: bigint('alternatives_max_price_minor', { mode: 'number' }),
  instantAlternatives: boolean('instant_alternatives').notNull(),
  instantTopPicks: boolean('instant_top_picks').notNull(),
  filter: jsonb('filter'),
  criteria: jsonb('criteria').notNull(),
  updatedAt: at('updated_at').notNull(),
}

/** Internal (row type WantManagerPipelineWant): every want with its criteria; no user ID. */
export const vWants = schema
  .view('v_wants', {
    ...wantViewColumns,
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    paid: boolean('paid').notNull(),
  })
  .existing()

/** Internal (row type WantManagerTermsByCentre): want counts per centre and family. */
export const vWantTermsByCentre = schema
  .view('v_want_terms_by_centre', {
    centreId: text('centre_id').notNull(),
    family: text('family').notNull(),
    wantCount: bigint('want_count', { mode: 'number' }).notNull(),
    paidWantCount: bigint('paid_want_count', { mode: 'number' }).notNull(),
  })
  .existing()

/** Internal (row type WantManagerWantPart): distinct wanted parts per centre. */
export const vWantParts = schema
  .view('v_want_parts', {
    centreId: text('centre_id').notNull(),
    partType: text('part_type').notNull(),
    catalogueId: text('catalogue_id'),
    family: text('family'),
  })
  .existing()

/** Internal (row type WantManagerWantArea): centre, rounded point, radius, for details-selector. */
export const vWantAreas = schema
  .view('v_want_areas', {
    centreId: text('centre_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    radiusKm: integer('radius_km').notNull(),
    acceptsDelivery: boolean('accepts_delivery').notNull(),
  })
  .existing()

/** User-facing (row type WantManagerWant, minus userId): the caller's own wants. */
export const vWantManagerWants = schema
  .view('v_want_manager_wants', {
    ...wantViewColumns,
    centreVerified: boolean('centre_verified').notNull(),
    createdAt: at('created_at').notNull(),
  })
  .existing()
