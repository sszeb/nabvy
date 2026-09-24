import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  jsonb,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { moduleSchema, timestampColumns } from '../module-schema'

// Tables of the scan-recognition module, all in the Postgres schema 'scan_recognition' (packages/db/README.md).
// Only services/scan-recognition writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate scan-recognition

export const schema = moduleSchema('scan-recognition')

const at = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * One row per scan (docs/design/modules/scan-recognition.md, "Owns"). `id` is the scan ID the
 * client generated, so a resubmitted form finds its row and never calls the model twice.
 * `identified` is set only once the scan is identified (barcode, model at or above the
 * threshold, or the user's confirmation) and is always one of `candidates`. No price column: this
 * module never writes a price (README.md, "Decisions").
 */
export const scanEvents = schema.table(
  'scan_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    barcode: text('barcode'),
    photoRef: text('photo_ref'),
    photoMediaType: text('photo_media_type'),
    photoExpiresAt: at('photo_expires_at'),
    method: text('method').notNull(),
    status: text('status').notNull(),
    identified: text('identified'),
    candidates: text('candidates').array().notNull().default(sql`'{}'::text[]`),
    confidence: doublePrecision('confidence'),
    confirmed: boolean('confirmed').notNull().default(false),
    description: jsonb('description'),
    searchPhrases: text('search_phrases').array().notNull().default(sql`'{}'::text[]`),
    modelCalled: boolean('model_called').notNull().default(false),
    modelRef: text('model_ref'),
    outputValid: boolean('output_valid'),
    promptVersion: text('prompt_version'),
    costGbpMicros: bigint('cost_gbp_micros', { mode: 'number' }).notNull().default(0),
    at: at('at').notNull(),
    identifiedAt: at('identified_at'),
    confirmedAt: at('confirmed_at'),
    ...timestampColumns(),
  },
  (t) => [
    index('scan_events_user_id_at_idx').on(t.userId, t.at),
    index('scan_events_photo_expires_at_idx')
      .on(t.photoExpiresAt)
      .where(sql`${t.photoRef} is not null`),
    check('scan_events_method', sql`${t.method} in ('barcode', 'cex_box', 'vision', 'none')`),
    check(
      'scan_events_status',
      sql`${t.status} in ('identified', 'needs_confirmation', 'unidentified')`,
    ),
    check('scan_events_barcode_format', sql`${t.barcode} ~ '^([0-9]{8}|[0-9]{12,14})$'`),
    check(
      'scan_events_photo_ref_per_user',
      sql`${t.photoRef} like 'scans/' || ${t.userId}::text || '/%'`,
    ),
    check(
      'scan_events_photo_media_type',
      sql`${t.photoMediaType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check('scan_events_confidence_range', sql`${t.confidence} between 0 and 1`),
    check('scan_events_candidates_max', sql`cardinality(${t.candidates}) <= 3`),
    check(
      'scan_events_identified_is_candidate',
      sql`${t.identified} is null or ${t.identified} = any(${t.candidates})`,
    ),
    check(
      'scan_events_status_consistent',
      sql`(${t.status} = 'identified') = (${t.identified} is not null)
        and (${t.status} <> 'needs_confirmation' or cardinality(${t.candidates}) > 0)
        and (not ${t.confirmed} or ${t.identified} is not null)`,
    ),
    check('scan_events_cost_nonnegative', sql`${t.costGbpMicros} >= 0`),
    check(
      'scan_events_model_fields',
      sql`${t.modelCalled} or (${t.modelRef} is null and ${t.outputValid} is null and ${t.costGbpMicros} = 0)`,
    ),
  ],
)

/** Internal view (row type ScanRecognitionScan in @nabvy/contracts/modules/scan-recognition). */
export const vScans = schema
  .view('v_scans', {
    id: uuid('id').notNull(),
    userId: uuid('user_id').notNull(),
    method: text('method').notNull(),
    status: text('status').notNull(),
    identified: text('identified'),
    confidence: doublePrecision('confidence'),
    confirmed: boolean('confirmed').notNull(),
    modelCalled: boolean('model_called').notNull(),
    at: at('at').notNull(),
    identifiedAt: at('identified_at'),
  })
  .existing()

/** User-facing view: the user's own scans (row type ScanRecognitionUserScan). */
export const vUserScans = schema
  .view('v_user_scans', {
    id: uuid('id').notNull(),
    method: text('method').notNull(),
    status: text('status').notNull(),
    identified: text('identified'),
    candidates: text('candidates').array().notNull(),
    confidence: doublePrecision('confidence'),
    confirmed: boolean('confirmed').notNull(),
    searchPhrases: text('search_phrases').array().notNull(),
    at: at('at').notNull(),
  })
  .existing()
