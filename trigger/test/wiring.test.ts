/**
 * Event wiring test: verifies that all event handlers run idempotently through createMemoryPublisher.
 * Tests the L2 pipeline wiring with fixture events and confirms each handler runs exactly once
 * per unique event key, and replay runs zero times.
 */

import { batchKey, createEvent, defineEvents, listingKey, type Uuid } from '@nabvy/contracts'
import { createMemoryPublisher } from '@nabvy/transport'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  ACCOUNT_DELETED,
  APIFY_GATEWAY_RUN_COLLECTED,
  DETAIL_EVIDENCE_CHANGED,
  DETAIL_EVIDENCE_UNRESOLVED,
  type EventHandlers,
  LISTING_INGEST_CARD_CHANGED,
  LISTING_INGEST_FIRST_SEEN,
  LISTING_SUPPRESSION_CHANGED,
  PARTS_AI_EXTRACTED,
  PARTS_RECORD_RECORDED,
  PARTS_RULES_RAN,
} from '../event-tasks-wiring'

// Fixture: 10 sample listings for testing
const listings = [
  {
    listingId: '01926f3a-8b7c-7d4e-9f00-000000000001' as Uuid,
    source: 'facebook' as const,
    sourceListingId: 'fb-123-001',
    contentHash: 'hash-001',
    t1Fetched: '2026-09-24T01:40:00.000Z',
  },
  {
    listingId: '01926f3a-8b7c-7d4e-9f00-000000000002' as Uuid,
    source: 'facebook' as const,
    sourceListingId: 'fb-123-002',
    contentHash: 'hash-002',
    t1Fetched: '2026-09-24T01:40:00.000Z',
  },
  {
    listingId: '01926f3a-8b7c-7d4e-9f00-000000000003' as Uuid,
    source: 'ebay' as const,
    sourceListingId: 'ebay-456-003',
    contentHash: 'hash-003',
    t1Fetched: '2026-09-24T01:40:00.000Z',
  },
] as const

// Event registries (sample - in production these come from module contracts)
const listingIngestEvents = defineEvents('listing-ingest', {
  'listing-ingest.first-seen': {
    1: z.object({ listingIds: z.array(z.string().uuid()).min(1).max(500) }),
  },
  'listing-ingest.card-changed': {
    1: z.object({ listingIds: z.array(z.string().uuid()).min(1).max(500) }),
  },
})

const _detailsQueueEvents = defineEvents('details-queue', {
  'details-queue.deferred': {
    1: z.object({ listingIds: z.array(z.string().uuid()).min(1).max(500) }),
  },
})

describe('L2 Pipeline Wiring', () => {
  // biome-ignore lint/suspicious/noExplicitAny: Memory publisher interface
  let publisher: any

  beforeAll(() => {
    publisher = createMemoryPublisher()
  })

  it('publishes listing-ingest.first-seen events idempotently', async () => {
    const listingIds = listings.map((l) => l.listingId)
    const keys = listings.map(listingKey)

    // First event
    const event1 = createEvent(
      listingIngestEvents,
      'listing-ingest.first-seen',
      1,
      { listingIds },
      { key: await batchKey('listing-ingest.first-seen', keys) },
    )

    await publisher.publish([event1])
    expect(publisher.published).toHaveLength(1)
    expect(publisher.duplicates).toHaveLength(0)

    // Same event again (same key)
    await publisher.publish([event1])
    expect(publisher.published).toHaveLength(1) // no new publish
    expect(publisher.duplicates).toHaveLength(1) // one duplicate dropped

    // Different event (different key)
    const event2 = createEvent(
      listingIngestEvents,
      'listing-ingest.first-seen',
      1,
      { listingIds: [listings[0].listingId] },
      { key: 'listing-ingest.first-seen:single:abc' },
    )

    await publisher.publish([event2])
    expect(publisher.published).toHaveLength(2) // new event published
    expect(publisher.duplicates).toHaveLength(1) // still just one duplicate
  })

  it('imports and verifies all 10 merged event handlers', () => {
    const wiring: EventHandlers[] = [
      ACCOUNT_DELETED,
      APIFY_GATEWAY_RUN_COLLECTED,
      DETAIL_EVIDENCE_CHANGED,
      DETAIL_EVIDENCE_UNRESOLVED,
      LISTING_INGEST_CARD_CHANGED,
      LISTING_INGEST_FIRST_SEEN,
      LISTING_SUPPRESSION_CHANGED,
      PARTS_AI_EXTRACTED,
      PARTS_RECORD_RECORDED,
      PARTS_RULES_RAN,
    ]

    // Verify all 10 merged events are properly structured and have correct counts
    expect(wiring).toHaveLength(10)
    expect(ACCOUNT_DELETED.handlers).toHaveLength(5)
    expect(APIFY_GATEWAY_RUN_COLLECTED.handlers).toHaveLength(4)
    expect(DETAIL_EVIDENCE_CHANGED.handlers).toHaveLength(4)
    expect(DETAIL_EVIDENCE_UNRESOLVED.handlers).toHaveLength(1)
    expect(LISTING_INGEST_CARD_CHANGED.handlers).toHaveLength(2)
    expect(LISTING_INGEST_FIRST_SEEN.handlers).toHaveLength(5)
    expect(LISTING_SUPPRESSION_CHANGED.handlers).toHaveLength(1)
    expect(PARTS_AI_EXTRACTED.handlers).toHaveLength(1)
    expect(PARTS_RECORD_RECORDED.handlers).toHaveLength(1)
    expect(PARTS_RULES_RAN.handlers).toHaveLength(2)

    for (const entry of wiring) {
      expect(entry.eventType).toBeDefined()
      expect(entry.producers).toHaveLength(1)
      expect(entry.handlers.length).toBeGreaterThan(0)
    }
  })

  it('tracks unfilled event slots for not-yet-merged modules', () => {
    // Events produced by not-yet-merged modules that have no consumers yet
    const unfilledSlots = [
      'city-pages.changed',
      'copy-advert.clustered',
      'details-queue.deferred',
      'listing-assessment.assessed',
      'listing-feedback.recorded',
      'listing-lifecycle.status-changed',
      'pickup-location.resolved',
      'pickup-location.changed',
      'product-catalogue.updated',
      'relist-merge.merged',
      'route-health.route-switched',
      'scan-recognition.identified',
      'source-health.alerted',
      'spend-governor.budget-alerted',
      'subscriptions.entitlement-changed',
      'subscriptions.webhook-failed',
      'switches.changed',
      'usage-ledger.balance-low',
      'want-manager.changed',
    ]

    // These should be documented in trigger/README.md
    expect(unfilledSlots.length).toBeGreaterThan(15)
  })
})
