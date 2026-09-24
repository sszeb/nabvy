import type { AppError, EventEnvelope } from '@nabvy/contracts'
import { index, integer, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the incidents module, all in the Postgres schema 'incidents' (packages/db/README.md).
// Only services/incidents writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate incidents

export const schema = moduleSchema('incidents')

/**
 * One row per dead-lettered event, keyed by the event's own idempotency key so a replayed
 * `record()` reopens the same row instead of creating another (docs/design/modules/incidents.md).
 * `payload` holds the whole original event envelope (id, type, v, at, key, payload), not just its
 * payload field, because `retry()` needs it to reconstruct and re-emit the original event.
 */
export const incidents = schema.table(
  'incidents',
  {
    id: idColumn(),
    eventType: text('event_type').notNull(),
    eventKey: text('event_key').notNull(),
    payload: jsonb('payload').$type<EventEnvelope>().notNull(),
    error: jsonb('error').$type<AppError>().notNull(),
    attempts: integer('attempts').notNull(),
    firstFailedAt: timestamp('first_failed_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestampColumns(),
  },
  (t) => [
    unique('incidents_event_key_key').on(t.eventKey),
    index('incidents_open_idx').on(t.resolvedAt),
  ],
)

/** Internal view: open (unresolved) incidents only. Declared here, created by hand-written SQL. */
export const vOpen = schema
  .view('v_open', {
    id: uuid('id'),
    eventType: text('event_type'),
    eventKey: text('event_key'),
    payload: jsonb('payload').$type<EventEnvelope>(),
    error: jsonb('error').$type<AppError>(),
    attempts: integer('attempts'),
    firstFailedAt: timestamp('first_failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  })
  .existing()
