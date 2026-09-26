import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the pickup-routes module, all in the Postgres schema 'pickup_routes' (packages/db/
// README.md; docs/design/modules/pickup-routes.md, "Owns"). Only services/pickup-routes writes
// them. There is no view over any of them, by the owner's decision (docs/decisions.md:174): the
// addresses, notes and points are the user's own, encrypted at rest with PICKUPS_DATA_KEY and
// decrypted only inside the module's functions inside withUser. Every table carries user_id and
// row-level security. After changing this file: pnpm db:generate pickup-routes

export const schema = moduleSchema('pickup-routes')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * An AES-256-GCM sealed blob (services/pickup-routes/src/domain/crypto.ts): version byte, 12-byte
 * IV, 16-byte tag, ciphertext. Never a plaintext address, postcode, note or point.
 */
const sealed = customType<{ data: Uint8Array; driverData: Uint8Array | Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
})

/**
 * One arranged pickup (search-map-routes.md §5.1). Plain columns are what a reminder or a plan
 * needs without decryption: the label, the day, the window, the service time, the flags, the
 * status. `private_enc` seals the postcode, address text, notes, the postcode's point and any
 * dragged pin together, so no coordinate or address ever sits in a plain column.
 */
export const pickups = schema.table(
  'pickups',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    label: text('label').notNull(),
    privateEnc: sealed('private_enc').notNull(),
    /** Whether the sealed blob holds a resolved point (location may have been off). */
    hasPoint: boolean('has_point').notNull().default(false),
    stopType: text('stop_type').notNull().default('collection'),
    day: date('day', { mode: 'string' }).notNull(),
    windowKind: text('window_kind').notNull(),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    serviceMinutes: integer('service_minutes').notNull().default(10),
    priceMinor: integer('price_minor'),
    bringCash: boolean('bring_cash').notNull().default(false),
    size: text('size').notNull().default('small'),
    mustGet: boolean('must_get').notNull().default(false),
    status: text('status').notNull().default('arranged'),
    listingId: uuid('listing_id'),
    ...timestampColumns(),
  },
  (t) => [
    index('pickups_user_id_idx').on(t.userId),
    index('pickups_user_day_idx').on(t.userId, t.day),
    index('pickups_day_idx').on(t.day),
    check('pickups_stop_type', sql`${t.stopType} in ('collection', 'meetup')`),
    check(
      'pickups_window_kind',
      sql`${t.windowKind} in ('at', 'between', 'after', 'before', 'unagreed')`,
    ),
    check('pickups_size', sql`${t.size} in ('small', 'boot', 'large')`),
    check(
      'pickups_status',
      sql`${t.status} in ('arranged', 'tentative', 'collected', 'cancelled', 'no_show')`,
    ),
    check('pickups_service_minutes', sql`${t.serviceMinutes} between 1 and 240`),
    check(
      'pickups_price_minor',
      sql`${t.priceMinor} is null or ${t.priceMinor} between 0 and 100000000`,
    ),
    check('pickups_label_length', sql`length(${t.label}) between 1 and 80`),
  ],
)

/** One scheduled reminder (§5.4), idempotent on (pickup, kind, due time). Label and time only. */
export const pickupReminders = schema.table(
  'pickup_reminders',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    pickupId: uuid('pickup_id')
      .notNull()
      .references(() => pickups.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    dueAt: at('due_at').notNull(),
    sentAt: at('sent_at'),
    ...timestampColumns(),
  },
  (t) => [
    index('pickup_reminders_user_id_idx').on(t.userId),
    index('pickup_reminders_due_idx').on(t.dueAt),
    uniqueIndex('pickup_reminders_identity_idx').on(t.pickupId, t.kind, t.dueAt),
    check('pickup_reminders_kind', sql`${t.kind} in ('evening_before', 'leave_by', 'unagreed')`),
  ],
)

/**
 * One planning day per user and date (§6.1, §7.9): where it starts and ends (points sealed),
 * the day window and the maximum drive time. Deleted with any pickup of that day (§7.9).
 */
export const pickupDays = schema.table(
  'pickup_days',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    startKind: text('start_kind').notNull().default('home'),
    endKind: text('end_kind').notNull().default('home'),
    /** Sealed start and end points for `custom` (and `current`, for the plan's lifetime only). */
    privateEnc: sealed('private_enc'),
    startTime: text('start_time').notNull(),
    latestFinish: text('latest_finish').notNull(),
    maxDriveMinutes: integer('max_drive_minutes'),
    ...timestampColumns(),
  },
  (t) => [
    index('pickup_days_user_id_idx').on(t.userId),
    uniqueIndex('pickup_days_identity_idx').on(t.userId, t.day),
    check('pickup_days_start_kind', sql`${t.startKind} in ('home', 'current', 'custom')`),
    check('pickup_days_end_kind', sql`${t.endKind} in ('home', 'open', 'custom')`),
    check(
      'pickup_days_max_drive',
      sql`${t.maxDriveMinutes} is null or ${t.maxDriveMinutes} between 10 and 720`,
    ),
  ],
)

/**
 * A plan version for a day (§7.9): the ordered stops with ETA, wait and lateness, the unassigned
 * stops with reasons, and totals. No coordinate or address text is stored; the line is recomputed
 * on open. A new version supersedes the last.
 */
export const routePlans = schema.table(
  'route_plans',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    dayId: uuid('day_id')
      .notNull()
      .references(() => pickupDays.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    mode: text('mode').notNull(),
    basis: text('basis').notNull(),
    osmBuild: text('osm_build'),
    startAt: at('start_at').notNull(),
    finishAt: at('finish_at').notNull(),
    driveSeconds: integer('drive_seconds').notNull(),
    distanceMetres: integer('distance_metres').notNull(),
    costMinor: integer('cost_minor'),
    costBasis: text('cost_basis'),
    /** PickupRoutesPlannedStop[] (pickup IDs and times only). */
    stops: jsonb('stops').notNull().$type<unknown[]>(),
    /** PickupRoutesUnassigned[]. */
    unassigned: jsonb('unassigned').notNull().$type<unknown[]>(),
    supersededAt: at('superseded_at'),
    ...timestampColumns(),
  },
  (t) => [
    index('route_plans_user_id_idx').on(t.userId),
    uniqueIndex('route_plans_identity_idx').on(t.dayId, t.version),
    check('route_plans_mode', sql`${t.mode} in ('optimised', 'my_order')`),
    check('route_plans_basis', sql`${t.basis} in ('router', 'estimate')`),
    check('route_plans_version', sql`${t.version} >= 1`),
  ],
)

/** The user's planner defaults (§7.9): home (sealed), day window, end at home, service time. */
export const plannerDefaults = schema.table(
  'planner_defaults',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    /** Sealed home postcode and point; null until set. */
    privateEnc: sealed('private_enc'),
    dayStart: text('day_start').notNull().default('09:00'),
    latestFinish: text('latest_finish').notNull().default('18:00'),
    endAtHome: boolean('end_at_home').notNull().default(true),
    serviceMinutes: integer('service_minutes').notNull().default(10),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex('planner_defaults_user_id_idx').on(t.userId),
    check('planner_defaults_service_minutes', sql`${t.serviceMinutes} between 1 and 240`),
  ],
)
