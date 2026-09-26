/**
 * Event task wiring (backlog L2): maps event types to their handlers and creates thin task wrappers.
 * Thin pattern: each task file (id: 'event-type') receives an EventEnvelope, runs all registered
 * handlers, and returns aggregated results. Handlers are factories that create EventHandler instances
 * with database transactions.
 *
 * This file documents the wiring and provides helper functions. Individual task files import from here.
 */

import type { EventEnvelope } from '@nabvy/contracts'
import type { EventHandler } from '@nabvy/transport'

/**
 * Handler factory: takes database transaction capability and returns an EventHandler ready to run.
 * Each module exports handler factories like `firstSeenHandler(deps)` from src/handlers/index.ts.
 */
export type HandlerFactory = (deps: { transaction: (fn: any) => Promise<any> }) => EventHandler

/**
 * Registry entry: all handlers for one event type.
 */
export interface EventHandlers {
  eventType: string
  producers: string[]
  handlers: { module: string; factory: HandlerFactory }[]
}

/**
 * Helper to run all handlers for an event.
 * Called by each trigger task after setting up database and publisher deps.
 */
export async function runAllHandlers(
  handlers: EventHandler[],
  envelope: EventEnvelope,
  attemptInfo: { attempt: number; maxAttempts: number; firstAttemptAt: string },
  deps: {
    publisher: any
    deadLetters: any
  },
): Promise<any[]> {
  const results: unknown[] = []
  for (const handler of handlers) {
    const outcome = await handler.run(envelope, attemptInfo, deps)
    results.push(outcome)
  }
  return results
}

// Event type wiring (listing of all merged modules and their handlers)

export const ACCOUNT_DELETED: EventHandlers = {
  eventType: 'account.deleted',
  producers: ['account'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'copy-advert', factory: () => null as any }, // TODO: import and create handler
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'lifecycle-messaging', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'marketing-consent', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'pricing-console', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'usage-ledger', factory: () => null as any },
  ],
}

export const APIFY_GATEWAY_RUN_COLLECTED: EventHandlers = {
  eventType: 'apify-gateway.run-collected',
  producers: ['apify-gateway'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'detail-evidence', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'details-queue', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'listing-ingest', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'run-coverage', factory: () => null as any },
  ],
}

export const DETAIL_EVIDENCE_CHANGED: EventHandlers = {
  eventType: 'detail-evidence.changed',
  producers: ['detail-evidence'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'copy-advert', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'parts-rules', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'pickup-location', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'relist-merge', factory: () => null as any },
  ],
}

export const DETAIL_EVIDENCE_UNRESOLVED: EventHandlers = {
  eventType: 'detail-evidence.unresolved',
  producers: ['detail-evidence'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'listing-lifecycle', factory: () => null as any },
  ],
}

export const LISTING_INGEST_CARD_CHANGED: EventHandlers = {
  eventType: 'listing-ingest.card-changed',
  producers: ['listing-ingest'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'copy-advert', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'listing-lifecycle', factory: () => null as any },
  ],
}

export const LISTING_INGEST_FIRST_SEEN: EventHandlers = {
  eventType: 'listing-ingest.first-seen',
  producers: ['listing-ingest'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'copy-advert', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'details-queue', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'details-selector', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'pickup-location', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'relist-merge', factory: () => null as any },
  ],
}

export const LISTING_SUPPRESSION_CHANGED: EventHandlers = {
  eventType: 'listing-suppression.changed',
  producers: ['listing-suppression'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'copy-advert', factory: () => null as any },
  ],
}

export const PARTS_AI_EXTRACTED: EventHandlers = {
  eventType: 'parts-ai.extracted',
  producers: ['parts-ai'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'parts-record', factory: () => null as any },
  ],
}

export const PARTS_RECORD_RECORDED: EventHandlers = {
  eventType: 'parts-record.recorded',
  producers: ['parts-record'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'listing-assessment', factory: () => null as any },
  ],
}

export const PARTS_RULES_RAN: EventHandlers = {
  eventType: 'parts-rules.ran',
  producers: ['parts-rules'],
  handlers: [
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'parts-ai', factory: () => null as any },
    // biome-ignore lint/suspicious/noExplicitAny: factory stub
    { module: 'parts-record', factory: () => null as any },
  ],
}
