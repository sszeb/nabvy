import { describe, expect, it } from 'vitest'
import {
  baselineBasis,
  centreOf,
  feedTypeOf,
  judge,
  kindOf,
  type SearchReport,
  searchesOf,
} from '../src/domain'
import { loadRun, RECORDED } from './support/database'

const recorded = loadRun(RECORDED)
const [base] = searchesOf(recorded.runSummary, [], null)
if (!base) throw new Error('the recorded run has one search')
const search = (patch: Partial<SearchReport>): SearchReport => ({ ...base, ...patch })
const none = { checked: false, skipped: false } as const

describe('reading searches', () => {
  it('reads the recorded search from RUN_SUMMARY.searches[]', () => {
    expect(base).toMatchObject({
      searchIndex: 0,
      centreId: '115935195086622',
      term: 'gaming pc',
      kind: 'newest',
      route: 'http',
      stopReason: 'results-limit',
      pages: 1,
      listings: 20,
      binding: 'verified',
      controls: {
        latitude: 50.836,
        longitude: -0.775,
        radiusKm: 65,
        sort: 'CREATION_TIME_DESCEND',
      },
    })
  })

  it('falls back to sourceOutcome rows, whose route vocabulary reads unknown', () => {
    const rows = recorded.dataset.filter((row) => row.recordType === 'sourceOutcome')
    const [s] = searchesOf({ ...recorded.runSummary, searches: [] }, rows, null)
    expect(s).toMatchObject({ route: 'unknown', reportedRoute: 'search', listings: 20, pages: 1 })
  })

  it('falls back to the actor input for a run that failed before reporting', () => {
    const found = searchesOf(null, [], {
      searchTerms: ['gaming pc', 'rtx 3090'],
      cityId: '115935195086622',
      sort: 'newest',
    })
    expect(found.map((s) => [s.term, s.centreId, s.kind, s.route, s.listings])).toEqual([
      ['gaming pc', '115935195086622', 'newest', 'unknown', 0],
      ['rtx 3090', '115935195086622', 'newest', 'unknown', 0],
    ])
  })

  it('takes the centre from the search URL only', () => {
    expect(centreOf('https://www.facebook.com/marketplace/115935195086622/search/?query=pc')).toBe(
      '115935195086622',
    )
    expect(centreOf('https://www.facebook.com/marketplace/item/1816901372840238/')).toBeNull()
    expect(centreOf('not a url')).toBeNull()
  })

  it('reads the check kind from the reported order, then the URL, then the run', () => {
    expect(kindOf('CREATION_TIME_DESCEND', null, null)).toBe('newest')
    expect(kindOf(null, 'https://x.test/?sortBy=creation_time_descend', null)).toBe('newest')
    expect(kindOf(null, 'https://x.test/?query=pc', 'default')).toBe('sweep')
    expect(kindOf(null, null, 'newest')).toBe('newest')
    expect(kindOf('BEST_MATCH', 'https://x.test/?sortBy=creation_time_descend', 'newest')).toBe(
      'unknown',
    )
  })
})

describe('judging', () => {
  it('our own cap is capped; source-no-new-listings is complete', () => {
    expect(judge(base, false, none).status).toBe('capped')
    for (const stopReason of ['page-cap', 'results-limit', 'time-limit'] as const) {
      expect(judge(search({ stopReason }), false, none).status).toBe('capped')
    }
    expect(judge(search({ stopReason: 'source-no-new-listings' }), false, none).status).toBe(
      'complete',
    )
  })

  it('degrades a failed run, a bad or unknown route, an unknown stop, an empty search and a gap', () => {
    expect(judge(base, true, none).reasons).toEqual(['run-failed'])
    expect(judge(search({ route: 'browser-fallback' }), false, none).status).toBe('degraded')
    expect(judge(search({ route: 'failed' }), false, none).status).toBe('degraded')
    expect(judge(search({ route: 'unknown' }), false, none).status).toBe('degraded')
    expect(judge(search({ stopReason: 'unknown' }), false, none).status).toBe('degraded')
    expect(judge(search({ listings: 0 }), false, none).status).toBe('degraded')
    expect(judge(base, false, { checked: true, shared: 0 })).toMatchObject({
      status: 'degraded',
      reasons: ['no-page-one-overlap'],
    })
    expect(judge(base, false, { checked: true, shared: 1 }).status).toBe('capped')
  })

  it('a skipped gap check and an unverified binding are noted, not degraded', () => {
    expect(judge(base, false, { checked: false, skipped: true })).toMatchObject({
      status: 'capped',
      reasons: ['overlap-unchecked'],
    })
    expect(judge(search({ binding: 'unverified' }), false, none)).toMatchObject({
      status: 'capped',
      reasons: ['binding-unverified'],
    })
  })

  it('a short feed is at most 6 pages or under 150 listings, sweeps only', () => {
    const sweep = (pages: number | null, listings: number) =>
      feedTypeOf(search({ kind: 'sweep', pages, listings }))
    expect(sweep(6, 1000)).toBe('short')
    expect(sweep(7, 150)).toBe('long')
    expect(sweep(7, 149)).toBe('short')
    expect(sweep(null, 150)).toBe('long')
    expect(feedTypeOf(search({ kind: 'newest', pages: 1, listings: 20 }))).toBeNull()
  })

  it('only healthy, verified, scoped judgements set a baseline', () => {
    const row = { status: 'capped', binding: 'verified', centreId: 'c', term: 't', kind: 'newest' }
    expect(baselineBasis(row)).toBe('bounded')
    expect(baselineBasis({ ...row, status: 'complete' })).toBe('complete')
    expect(baselineBasis({ ...row, status: 'degraded' })).toBeNull()
    expect(baselineBasis({ ...row, binding: 'unverified' })).toBeNull()
    expect(baselineBasis({ ...row, centreId: null })).toBeNull()
    expect(baselineBasis({ ...row, kind: 'unknown' })).toBeNull()
  })
})
