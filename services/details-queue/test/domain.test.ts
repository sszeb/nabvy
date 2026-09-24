import { describe, expect, it } from 'vitest'
import {
  chunk,
  deferredKey,
  detailsInput,
  londonDay,
  nextState,
  prioritiesAllowed,
  priorityOfSearchShape,
  priorityRank,
  routeFor,
  verdictFor,
} from '../src/domain'

const limits = { maxFailures: 2, maxRequeues: 1 }
const fresh = { attempts: 0, requeues: 0 }

describe('priority', () => {
  it('serves newest-check follow-ups, shortlisted refreshes, photos, then sweeps', () => {
    expect(
      (['sweep', 'photo-capture', 'new-listing', 'shortlisted'] as const)
        .slice()
        .sort((a, b) => priorityRank(a) - priorityRank(b)),
    ).toEqual(['new-listing', 'shortlisted', 'photo-capture', 'sweep'])
  })

  it('maps a first-seen listing to its search shape', () => {
    expect(priorityOfSearchShape('newest-check')).toBe('new-listing')
    expect(priorityOfSearchShape('catch-up')).toBe('new-listing')
    expect(priorityOfSearchShape('sweep-broad')).toBe('sweep')
    expect(priorityOfSearchShape(undefined)).toBe('sweep')
  })
})

describe('throttle', () => {
  it('holds everything at hold-new', () => {
    expect(prioritiesAllowed('hold-new')).toEqual([])
  })
  it('lets sweep follow-ups wait at slow-paid and slow-sweeps', () => {
    expect(prioritiesAllowed('slow-paid')).not.toContain('sweep')
    expect(prioritiesAllowed('slow-sweeps')).toEqual([
      'new-listing',
      'shortlisted',
      'photo-capture',
    ])
  })
  it('allows everything below slow-paid', () => {
    expect(prioritiesAllowed('none')).toHaveLength(4)
    expect(prioritiesAllowed('slow-free')).toHaveLength(4)
  })
})

describe('route', () => {
  it('text follows route-health; photo is always page', () => {
    expect(routeFor('text', 'graphql')).toBe('graphql')
    expect(routeFor('text', 'page')).toBe('page')
    expect(routeFor('photo', 'graphql')).toBe('page')
  })
})

describe('londonDay', () => {
  it('uses the London calendar day across BST', () => {
    // 23:30 UTC on 24 September is 00:30 on the 25th in London (BST).
    expect(londonDay(new Date('2026-09-24T23:30:00Z'))).toBe('2026-09-25')
    expect(londonDay(new Date('2026-09-24T22:59:59Z'))).toBe('2026-09-24')
    // In winter London is UTC.
    expect(londonDay(new Date('2026-12-24T23:30:00Z'))).toBe('2026-12-24')
  })
})

describe('detailsInput', () => {
  const lim = { maxRunSeconds: 900, requestsPerId: 2, requestsMargin: 20, maxRequests: 1000 }
  it('builds a v3 IDs-only input with the gateway-required fields', () => {
    const input = detailsInput(['1', '2'], 'graphql', lim)
    expect(input).toMatchObject({
      inputVersion: 3,
      listingIds: ['1', '2'],
      includeDetails: true,
      detailRoute: 'graphql',
      maxDetails: 2,
      maxRequests: 24,
      maxRunSeconds: 900,
      browserFallback: false,
      useDetailCache: false,
      proxyConfiguration: { apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'GB' },
    })
    expect(input).not.toHaveProperty('searchTerms')
    expect(input).not.toHaveProperty('excludeListingIds')
  })
  it('keeps maxRequests within the gateway cap', () => {
    expect(detailsInput(Array(200).fill('1'), 'page', lim).maxRequests).toBe(420)
    expect(
      detailsInput(Array(200).fill('1'), 'page', { ...lim, requestsPerId: 6 }).maxRequests,
    ).toBe(1000)
  })
})

describe('verdictFor (2.10)', () => {
  it('a full description is done', () => {
    expect(verdictFor({ detailOutcome: 'collected', descriptionStatus: 'full_verified' })).toEqual({
      action: 'done',
      outcome: 'full_verified',
    })
  })
  it('not attempted is requeued, not failed', () => {
    for (const o of [
      'not-requested-cap',
      'not-requested-request-cap',
      'not-requested-time-limit',
    ]) {
      expect(verdictFor({ detailOutcome: o }).action).toBe('requeue')
    }
  })
  it('no row, an extraction error or an unknown outcome is a failed attempt', () => {
    expect(verdictFor(undefined)).toEqual({ action: 'fail', outcome: 'no-row' })
    expect(verdictFor({ detailOutcome: 'extraction-error' }).action).toBe('fail')
    expect(verdictFor({ detailOutcome: 'brand-new' })).toEqual({
      action: 'fail',
      outcome: 'unknown:brand-new',
    })
  })
  it('partial, missing, stale-fallback and no status are refreshed', () => {
    expect(verdictFor({ descriptionStatus: 'partial' }).action).toBe('refresh')
    expect(verdictFor({ descriptionStatus: 'missing' }).action).toBe('refresh')
    expect(verdictFor({ descriptionStatus: 'stale-fallback' }).action).toBe('refresh')
    expect(verdictFor({ detailOutcome: 'collected' })).toEqual({
      action: 'refresh',
      outcome: 'partial',
    })
  })
  it('a removed listing is done', () => {
    expect(verdictFor({ directItemUnresolved: true }).action).toBe('done')
  })
})

describe('nextState boundaries', () => {
  it('requeues a refresh once, then leaves it done', () => {
    const refresh = { action: 'refresh', outcome: 'partial' } as const
    expect(nextState(refresh, fresh, limits)).toEqual({
      status: 'queued',
      attempts: 0,
      requeues: 1,
    })
    expect(nextState(refresh, { attempts: 0, requeues: 1 }, limits)).toEqual({
      status: 'done',
      attempts: 0,
      requeues: 1,
    })
  })
  it('fails at maxFailures, not before', () => {
    const fail = { action: 'fail', outcome: 'no-row' } as const
    expect(nextState(fail, fresh, limits).status).toBe('queued')
    expect(nextState(fail, { attempts: 1, requeues: 0 }, limits)).toEqual({
      status: 'failed',
      attempts: 2,
      requeues: 0,
    })
  })
  it('a requeue keeps the counters', () => {
    expect(
      nextState({ action: 'requeue', outcome: 'x' }, { attempts: 1, requeues: 1 }, limits),
    ).toEqual({
      status: 'queued',
      attempts: 1,
      requeues: 1,
    })
  })
})

describe('helpers', () => {
  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('keys a deferral by day and set, whatever the order', () => {
    expect(deferredKey('2026-09-24', ['2', '1'])).toBe(deferredKey('2026-09-24', ['1', '2']))
    expect(deferredKey('2026-09-25', ['1', '2'])).not.toBe(deferredKey('2026-09-24', ['1', '2']))
  })
})
