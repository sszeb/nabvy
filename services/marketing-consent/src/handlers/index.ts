// Event handlers. Thin: parse, call the repo, return (docs/design/modules/_rules.md, rule 2).
// marketing-consent sits outside the T0-T7 chain (rule 10), so it stamps no T-timestamp.
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import * as repo from '../repo'

export interface AccountDeletedDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * Consumes `account.deleted`: purges this module's `marketing_consents` rows for the deleted user
 * within 24 hours (rule 12 of `_rules.md`: "every module that holds user rows purges them on
 * `account.deleted`"). Idempotent (rule 8): once a user's rows are gone, a replay deletes nothing.
 * `email_suppressions` and `newsletter_subscribers` are keyed by email hash, not `userId`, and are
 * never purged here (README.md, "Decisions"): they carry no identifying data once the deleted
 * account's own row is gone, and a suppression must survive deletion so the address is never
 * mailed again.
 */
export function accountDeletedHandler(deps: AccountDeletedDeps): EventHandler {
  return defineHandler({
    consumer: 'marketing-consent',
    registry: accountEvents,
    type: 'account.deleted',
    async handle(event) {
      await deps.transaction((q) => repo.purgeUser(q, event.payload.userId))
      return { ok: true, value: undefined }
    },
  })
}
