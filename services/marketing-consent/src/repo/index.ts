// Database access to the marketing_consent schema only. Other modules read v_consents directly
// (packages/db/README.md); this file is for services/marketing-consent's own use.
import type { Queryable } from '@nabvy/db'
import {
  emailSuppressions,
  marketingConsents,
  newsletterSubscribers,
} from '@nabvy/db/schema/marketing-consent'
import { and, eq } from 'drizzle-orm'

export type ConsentRow = typeof marketingConsents.$inferSelect
export type SuppressionRow = typeof emailSuppressions.$inferSelect
export type NewsletterRow = typeof newsletterSubscribers.$inferSelect

export async function selectConsentRows(q: Queryable, userId: string): Promise<ConsentRow[]> {
  return q.select().from(marketingConsents).where(eq(marketingConsents.userId, userId))
}

export async function upsertConsent(
  q: Queryable,
  row: {
    userId: string
    category: string
    granted: boolean
    until: Date | null
    source: string
    at: Date
  },
): Promise<void> {
  await q
    .insert(marketingConsents)
    .values(row)
    .onConflictDoUpdate({
      target: [marketingConsents.userId, marketingConsents.category],
      set: { granted: row.granted, until: row.until, source: row.source, at: row.at },
    })
}

/** Ends an active pause: no row means "not paused" (services/marketing-consent/src/domain). */
export async function deletePause(q: Queryable, userId: string): Promise<void> {
  await q
    .delete(marketingConsents)
    .where(and(eq(marketingConsents.userId, userId), eq(marketingConsents.category, 'all')))
}

/** Erases every row this module holds for the given users (rule 12: purge on `account.deleted`). */
export async function purgeUser(q: Queryable, userId: string): Promise<void> {
  await q.delete(marketingConsents).where(eq(marketingConsents.userId, userId))
}

export async function selectSuppression(
  q: Queryable,
  emailHash: string,
): Promise<SuppressionRow | undefined> {
  const [row] = await q
    .select()
    .from(emailSuppressions)
    .where(eq(emailSuppressions.emailHash, emailHash))
  return row
}

export async function upsertSuppression(
  q: Queryable,
  row: { emailHash: string; reason: string; source: string; at: Date },
): Promise<void> {
  await q
    .insert(emailSuppressions)
    .values(row)
    .onConflictDoUpdate({
      target: emailSuppressions.emailHash,
      set: { reason: row.reason, source: row.source, at: row.at },
    })
}

export async function selectNewsletterSubscriber(
  q: Queryable,
  emailHash: string,
): Promise<NewsletterRow | undefined> {
  const [row] = await q
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.emailHash, emailHash))
  return row
}

export async function upsertNewsletterSubscriber(
  q: Queryable,
  row: { emailHash: string; consentSource: string; at: Date },
): Promise<void> {
  await q
    .insert(newsletterSubscribers)
    .values(row)
    .onConflictDoUpdate({
      target: newsletterSubscribers.emailHash,
      set: { consentSource: row.consentSource, at: row.at, unsubscribedAt: null },
    })
}

export async function markNewsletterUnsubscribed(
  q: Queryable,
  emailHash: string,
  at: Date,
): Promise<void> {
  await q
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: at })
    .where(eq(newsletterSubscribers.emailHash, emailHash))
}
