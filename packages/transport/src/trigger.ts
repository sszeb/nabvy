import { publishBatchLimit } from '@nabvy/config'
import { EventEnvelope } from '@nabvy/contracts'
import { byTask, type Publisher } from './publisher'

/** One task run to start: the envelope is the payload, its `key` the idempotency key. */
export interface TriggerItem {
  payload: EventEnvelope
  idempotencyKey: string
}

/**
 * The slice of the Trigger.dev SDK the publisher needs. Structural, so this package needs neither
 * the SDK nor credentials; task 1.2 wires it to `tasks.batchTrigger`, creating each key with
 * `idempotencyKeys.create(key, { scope: 'global' })` so a replay from another run is still
 * dropped (packages/transport/README.md).
 */
export interface TriggerClient {
  batchTrigger(taskId: string, items: readonly TriggerItem[]): Promise<unknown>
}

/**
 * The Trigger.dev publisher: one batch trigger per task, split at `publishBatchLimit`. A failed
 * call throws; the caller's own attempt then fails and is retried, and the keys make the envelopes
 * that did get through no-ops the second time.
 */
export function createTriggerPublisher(client: TriggerClient): Publisher {
  return {
    async publish(envelopes) {
      for (const [taskId, group] of byTask(envelopes.map((e) => EventEnvelope.parse(e)))) {
        for (let i = 0; i < group.length; i += publishBatchLimit) {
          const items = group
            .slice(i, i + publishBatchLimit)
            .map((payload) => ({ payload, idempotencyKey: payload.key }))
          await client.batchTrigger(taskId, items)
        }
      }
    },
  }
}
