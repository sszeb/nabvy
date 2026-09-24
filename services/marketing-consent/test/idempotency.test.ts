import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isSuppressed,
  pauseAll,
  recordSuppression,
  resumeAll,
  setPreference,
  subscribeNewsletter,
  unsubscribeNewsletter,
} from '../src'
import { hashEmail } from '../src/domain'
import { InMemorySuppressionSyncClient } from '../src/suppression-sync'
import { createTestDatabase, type TestDatabase } from './support/database'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

describe('idempotency', () => {
  it('setPreference upserts: a repeat call for the same category writes one row', async () => {
    const userId = '00000000-0000-4000-8000-0000000000e1'
    await t.createUser({ userId })
    await t.as(
      'nabvy_app',
      (tx) => setPreference(tx, { userId, category: 'tips', granted: true, source: 'signup' }),
      userId,
    )
    await t.as(
      'nabvy_app',
      (tx) =>
        setPreference(tx, {
          userId,
          category: 'tips',
          granted: false,
          source: 'preference-centre',
        }),
      userId,
    )
    const rows = await t.sql(
      `select granted, source from marketing_consent.marketing_consents where user_id = $1 and category = 'tips'`,
      [userId],
    )
    expect(rows).toEqual([{ granted: false, source: 'preference-centre' }])
  })

  it('recordSuppression upserts on the email hash: a repeated report writes one row', async () => {
    const client = new InMemorySuppressionSyncClient()
    await t.as('nabvy_pipeline', (tx) =>
      recordSuppression(
        tx,
        { email: 'bounced@example.com', reason: 'bounce', source: 'resend' },
        client,
      ),
    )
    await t.as('nabvy_pipeline', (tx) =>
      recordSuppression(
        tx,
        { email: 'Bounced@Example.com', reason: 'complaint', source: 'posthog' },
        client,
      ),
    )
    const rows = await t.sql('select count(*)::int as n from marketing_consent.email_suppressions')
    expect(Number(rows[0]?.n)).toBe(1)
    expect(await t.as('nabvy_pipeline', (tx) => isSuppressed(tx, 'BOUNCED@example.com'))).toBe(true)
    expect(client.calls).toHaveLength(2)
  })

  it('subscribeNewsletter upserts and clears a prior unsubscribe on resubscribe', async () => {
    const email = 'reader@example.com'
    const emailHash = hashEmail(email)
    await t.as('nabvy_pipeline', (tx) => subscribeNewsletter(tx, { email, source: 'waitlist' }))
    await t.as('nabvy_pipeline', (tx) => unsubscribeNewsletter(tx, { email }))
    let rows = await t.sql(
      'select unsubscribed_at from marketing_consent.newsletter_subscribers where email_hash = $1',
      [emailHash],
    )
    expect(rows[0]?.unsubscribed_at).not.toBeNull()

    await t.as('nabvy_pipeline', (tx) => subscribeNewsletter(tx, { email, source: 'price-page' }))
    rows = await t.sql(
      'select unsubscribed_at, consent_source from marketing_consent.newsletter_subscribers where email_hash = $1',
      [emailHash],
    )
    expect(rows).toEqual([{ unsubscribed_at: null, consent_source: 'price-page' }])
    const total = await t.sql(
      'select count(*)::int as n from marketing_consent.newsletter_subscribers',
    )
    expect(Number(total[0]?.n)).toBe(1)
  })

  it('pauseAll then resumeAll is a no-op the second time: no row left afterwards', async () => {
    const userId = '00000000-0000-4000-8000-0000000000e2'
    await t.createUser({ userId })
    await t.as('nabvy_app', (tx) => pauseAll(tx, { userId, source: 'preference-centre' }), userId)
    await t.as('nabvy_app', (tx) => resumeAll(tx, { userId }), userId)
    await t.as('nabvy_app', (tx) => resumeAll(tx, { userId }), userId)
    const rows = await t.sql(
      `select count(*)::int as n from marketing_consent.marketing_consents where user_id = $1`,
      [userId],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })
})
