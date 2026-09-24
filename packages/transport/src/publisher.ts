import {
  createEvent,
  type EventEnvelope,
  type EventRegistry,
  latestVersion,
  taskIdFor,
} from '@nabvy/contracts'
import type { z } from 'zod'

/**
 * Publishes thin events (docs/contracts.md, "Events"). Each envelope goes to the task named after
 * its type (`listing.new` → `listing-new`), with the envelope `key` as the idempotency key, so
 * publishing the same key twice starts the consumer once.
 */
export interface Publisher {
  publish(envelopes: readonly EventEnvelope[]): Promise<void>
}

/**
 * Builds the latest version of one of the caller's own events and publishes it. `key` must be
 * derived from the input (`listingKey`, `batchKey`, or a natural ID with its version), never
 * random, so a handler that runs twice publishes the same key and the transport drops the second.
 */
export async function emit<R extends EventRegistry, T extends keyof R['definitions'] & string>(
  publisher: Publisher,
  registry: R,
  type: T,
  payload: z.input<R['definitions'][T][keyof R['definitions'][T] & number]>,
  options: { key: string },
): Promise<EventEnvelope> {
  const v = latestVersion(registry, type)
  const envelope = createEvent(registry, type, v, payload as never, options) as EventEnvelope
  await publisher.publish([envelope])
  return envelope
}

/** Groups envelopes by their task ID, keeping order within each group. */
export function byTask(envelopes: readonly EventEnvelope[]): Map<string, EventEnvelope[]> {
  const groups = new Map<string, EventEnvelope[]>()
  for (const envelope of envelopes) {
    const taskId = taskIdFor(envelope.type)
    const group = groups.get(taskId)
    if (group) group.push(envelope)
    else groups.set(taskId, [envelope])
  }
  return groups
}
