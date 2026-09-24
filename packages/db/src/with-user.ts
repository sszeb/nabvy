import { Uuid } from '@nabvy/contracts'
import { sql } from 'drizzle-orm'
import { type Db, getDb, type Tx } from './client'

/**
 * Runs `fn` in a transaction scoped to one user: `app.user_id` is set with `set_config(…, true)`
 * (the parameterised form of `SET LOCAL`), so RLS policies built on `nabvy_core.current_user_id()`
 * see only that user's rows, and the setting ends with the transaction. A query outside
 * `withUser` sees no user rows at all (deny by default). docs/engineering.md, docs/security.md.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  db: Db = getDb('app'),
): Promise<T> {
  const id = Uuid.parse(userId)
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${id}, true)`)
    return fn(tx)
  })
}

/** Runs `fn` in a pipeline transaction (no user). Pipeline policies are role-scoped. */
export async function withPipeline<T>(
  fn: (tx: Tx) => Promise<T>,
  db: Db = getDb('pipeline'),
): Promise<T> {
  return db.transaction(fn)
}
