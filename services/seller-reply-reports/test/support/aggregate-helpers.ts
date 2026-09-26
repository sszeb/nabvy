import type { TestDatabase } from './database'

export { aggregate, onStandingChanged, resolve } from '../../src/index'

/** A `bought` verdict in listing-feedback (what v_bought_for_reports shows). */
export async function recordVerdictFixture(
  db: TestDatabase,
  userId: string,
  listingId: string,
  at: Date,
): Promise<void> {
  await db.sql(
    `insert into listing_feedback.verdicts (user_id, listing_id, verdict, at) values ($1, $2, 'bought', $3)`,
    [userId, listingId, at.toISOString()],
  )
}
