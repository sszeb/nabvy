// Suppression sync: pushing a bounce or complaint recorded from one provider's webhook into the
// other provider's own suppression list (docs/marketing.md, "Deliverability": "bounce and
// complaint suppression shared between Resend and PostHog"). Resend and PostHog accounts do not
// exist yet (this session's brief), so there is nothing to call: this interface is the seam a
// later module session wires to the real Resend and PostHog APIs, and `InMemorySuppressionSyncClient`
// is the only implementation today, recording what it would have sent for tests to assert against.
import type { MarketingConsentSuppressionReason } from '@nabvy/contracts/modules/marketing-consent'

export interface SuppressionSyncInput {
  emailHash: string
  reason: MarketingConsentSuppressionReason
}

/** Pushes a suppression into the provider(s) that did not originate it. */
export interface SuppressionSyncClient {
  sync(input: SuppressionSyncInput): Promise<void>
}

/** Records every call instead of contacting a provider; the default until real clients exist. */
export class InMemorySuppressionSyncClient implements SuppressionSyncClient {
  readonly calls: SuppressionSyncInput[] = []

  async sync(input: SuppressionSyncInput): Promise<void> {
    this.calls.push(input)
  }
}
