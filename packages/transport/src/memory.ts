import { EventEnvelope } from '@nabvy/contracts'
import { byTask, type Publisher } from './publisher'

export interface MemoryPublisher extends Publisher {
  /** Envelopes accepted, in publish order. */
  readonly published: readonly EventEnvelope[]
  /** Envelopes dropped because their task already had the same key. */
  readonly duplicates: readonly EventEnvelope[]
  /** Accepted envelopes for one event type. */
  ofType(type: string): EventEnvelope[]
  clear(): void
}

/**
 * The publisher for tests and local runs. Like Trigger.dev's idempotency keys, a second publish
 * of the same key to the same task is dropped (and kept in `duplicates` for assertions).
 */
export function createMemoryPublisher(): MemoryPublisher {
  const published: EventEnvelope[] = []
  const duplicates: EventEnvelope[] = []
  const seen = new Set<string>()
  return {
    published,
    duplicates,
    async publish(envelopes) {
      for (const [taskId, group] of byTask(envelopes.map((e) => EventEnvelope.parse(e)))) {
        for (const envelope of group) {
          const id = `${taskId}\n${envelope.key}`
          if (seen.has(id)) {
            duplicates.push(envelope)
            continue
          }
          seen.add(id)
          published.push(envelope)
        }
      }
    },
    ofType: (type) => published.filter((e) => e.type === type),
    clear() {
      published.length = 0
      duplicates.length = 0
      seen.clear()
    },
  }
}
