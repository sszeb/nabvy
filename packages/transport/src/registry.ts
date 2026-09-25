/**
 * Event handler registry: maps event types to all modules that consume them.
 * Built from handler exports, typed by contracts. Used by trigger tasks to dispatch events.
 * (Backlog L2, packages/transport README "Wiring").
 */

import type { EventEnvelope } from '@nabvy/contracts'
import type { EventHandler } from './handler'

/**
 * Registry entry: one event type with all its consumers' handlers.
 * Task files iterate this to dispatch the event to all consumers.
 */
export interface RegistryEntry {
  eventType: string
  producers: string[] // modules that emit this event
  consumers: { module: string; handler: EventHandler }[] // modules that consume it
}

/**
 * Full registry: event type -> entry. Built at startup from module handler exports.
 * Unfilled slots (no consumer handlers merged yet) list producers only.
 */
export type EventRegistry = Map<string, RegistryEntry>

/**
 * Create an empty registry to be populated during wiring phase.
 * In production, this is built from `defineEventRegistry` in trigger/registry.ts
 * after all module handlers are imported.
 */
export function createEventRegistry(): EventRegistry {
  return new Map()
}

/**
 * Register handlers for an event type. Called during registry initialization
 * to wire up all producers and consumers. Multiple calls add to the same entry.
 */
export function registerEvent(
  registry: EventRegistry,
  eventType: string,
  options: {
    producers?: string[]
    consumers?: { module: string; handler: EventHandler }[]
  },
): void {
  const existing = registry.get(eventType)
  const entry: RegistryEntry = {
    eventType,
    producers: [...(existing?.producers ?? []), ...(options.producers ?? [])],
    consumers: [...(existing?.consumers ?? []), ...(options.consumers ?? [])],
  }
  registry.set(eventType, entry)
}

/**
 * Dispatch an event to all registered consumers and aggregate results.
 * Used by trigger task wrappers to run all handlers for an event type.
 */
export async function dispatchEvent(
  registry: EventRegistry,
  envelope: EventEnvelope,
  attemptInfo: { attempt: number; maxAttempts: number; firstAttemptAt: string },
  deps: {
    publisher: { publish(envelopes: readonly EventEnvelope[]): Promise<void> }
    deadLetters: {
      record(input: {
        envelope: EventEnvelope
        error: { code: string; message: string }
        attempts: number
        firstFailedAt: string
      }): Promise<{ event: EventEnvelope }>
    }
    now?: () => Date
  },
): Promise<{
  handled: number
  deadLettered: number
  errors: { consumer: string; error: string }[]
}> {
  const entry = registry.get(envelope.type)
  if (!entry || entry.consumers.length === 0) {
    return { handled: 0, deadLettered: 0, errors: [{ consumer: 'all', error: 'no handlers' }] }
  }

  const results = { handled: 0, deadLettered: 0, errors: [] as { consumer: string; error: string }[] }

  for (const { module, handler } of entry.consumers) {
    try {
      const outcome = await handler.run(envelope, attemptInfo, {
        publisher: deps.publisher,
        deadLetters: deps.deadLetters,
        now: deps.now,
      })
      if (outcome.status === 'handled') results.handled++
      else if (outcome.status === 'dead-lettered') results.deadLettered++
      else results.errors.push({ consumer: module, error: outcome.status })
    } catch (err) {
      results.errors.push({
        consumer: module,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}
