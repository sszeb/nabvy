import {
  events,
  MARKETING_CONSENT_USER_CATEGORIES,
  MarketingConsent,
  MarketingConsentCanMarketInput,
  module,
} from '@nabvy/contracts/modules/marketing-consent'
import { vConsents } from '@nabvy/db/schema/marketing-consent'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

describe('marketing-consent contracts', () => {
  it('declares its name and publishes no events (only canMarket(), module card "Outputs")', () => {
    expect(module).toBe('marketing-consent')
    expect(events.module).toBe('marketing-consent')
    expect(Object.keys(events.definitions)).toEqual([])
  })

  it('MarketingConsent has exactly the columns of v_consents', () => {
    const columns = Object.keys(getViewConfig(vConsents).selectedFields)
    expect(columns.sort()).toEqual(Object.keys(MarketingConsent.shape).sort())
  })

  it('the four user-facing categories match docs/marketing.md, "Preference centre"', () => {
    expect(MARKETING_CONSENT_USER_CATEGORIES).toEqual([
      'tips',
      'offers',
      'product_updates',
      'weekly_digest',
    ])
  })

  it('MarketingConsentCanMarketInput refuses the pseudo-category all', () => {
    const result = MarketingConsentCanMarketInput.safeParse({
      userId: '00000000-0000-4000-8000-000000000001',
      email: 'person@example.com',
      category: 'all',
    })
    expect(result.success).toBe(false)
  })

  it('normalises the email (trim, lower case) before validating it', () => {
    const parsed = MarketingConsentCanMarketInput.parse({
      userId: '00000000-0000-4000-8000-000000000001',
      email: '  Person@Example.com  ',
      category: 'tips',
    })
    expect(parsed.email).toBe('person@example.com')
  })

  it('rejects an unknown field (thin, strict)', () => {
    const result = MarketingConsent.safeParse({
      userId: '00000000-0000-4000-8000-000000000001',
      category: 'tips',
      granted: true,
      until: null,
      source: 'signup',
      at: '2026-09-24T00:00:00.000Z',
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})
