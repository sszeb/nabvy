// Event handler: `account.deleted` → erase this module's user rows (rule 12). Idempotent: a
// redelivery finds nothing left to delete.
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { purge } from '../index'

export interface AccountDeletedDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

export function accountDeletedHandler(deps: AccountDeletedDeps): EventHandler {
  return defineHandler({
    consumer: 'subscriptions',
    registry: accountEvents,
    type: 'account.deleted',
    async handle(event) {
      await deps.transaction((q) => purge(q, [event.payload.userId]))
      return { ok: true, value: undefined }
    },
  })
}
