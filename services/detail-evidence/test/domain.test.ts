import { describe, expect, it } from 'vitest'
import {
  attributesOf,
  conditionOf,
  type EvidenceHashInput,
  evidenceHash,
  firstPerListing,
  linksExpireAt,
  normaliseText,
  readDetail,
} from '../src/domain'
import { loadRun, RECORDED } from './support/database'

const recorded = loadRun(RECORDED)
const rows = recorded.dataset
const AT = '2026-09-24T01:40:43.415Z'

const base: EvidenceHashInput = {
  title: 'Gaming PC',
  description: 'RTX 3060, Ryzen 5 3600.\nCollection only.',
  attributes: [{ name: 'Condition', label: 'Used – good', value: 'used_good' }],
  detailSections: [],
  customTitle: null,
  customSubtitles: [],
  condition: 'used_good',
  categoryId: '1792291877663080',
  categoryPath: ['Electronics', 'Computers'],
}

describe('normaliseText', () => {
  it('drops trailing whitespace on every line and at both ends, and nothing else', () => {
    expect(normaliseText('  a  \r\nb\t\n\n c \n')).toBe('a\nb\n\n c')
    expect(normaliseText('Case Kept')).toBe('Case Kept')
  })
})

describe('evidenceHash', () => {
  it('is 64 lowercase hex characters', () => {
    expect(evidenceHash(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores trailing whitespace and attribute order', () => {
    const same = evidenceHash({
      ...base,
      description: 'RTX 3060, Ryzen 5 3600.  \nCollection only. \n',
      attributes: [...base.attributes],
    })
    expect(same).toBe(evidenceHash(base))
    const two = [
      { name: 'Brand', label: 'MSI', value: 'MSI' },
      { name: 'Condition', label: 'New', value: 'new' },
    ]
    expect(evidenceHash({ ...base, attributes: two })).toBe(
      evidenceHash({ ...base, attributes: [...two].reverse() }),
    )
  })

  it('changes with each allowlisted field', () => {
    const h = evidenceHash(base)
    const edits: Partial<EvidenceHashInput>[] = [
      { title: 'Gaming PC!' },
      { description: 'RTX 3070' },
      { description: null },
      { attributes: [] },
      { detailSections: [{ name: 'Processor type', label: 'x', value: 'x' }] },
      { customTitle: 'Bundle' },
      { customSubtitles: ['Collection only'] },
      { condition: 'new' },
      { categoryId: '1' },
      { categoryPath: ['Electronics'] },
    ]
    for (const edit of edits) expect(evidenceHash({ ...base, ...edit })).not.toBe(h)
  })

  it('the recorded trailing-whitespace pair hashes the same (dataset.json:3722,3745)', () => {
    const row = rows.find((r) => r.listingId === '2126837844711748') as Record<string, unknown>
    const copy = (row.sourceFields as { detail: { description: string } }).detail.description
    expect(copy).not.toBe(row.description)
    const a = readDetail(row, 10, AT, 104)
    const b = readDetail({ ...row, description: copy }, 10, AT, 104)
    expect(a?.evidence?.evidenceHash).toBe(b?.evidence?.evidenceHash)
  })
})

describe('attributes and condition', () => {
  it('reads the machine value of Condition, never the label', () => {
    const attributes = attributesOf([
      { label: 'Used – like new', value: 'used_like_new', attribute_name: 'Condition' },
      { label: 'MSI', value: 'MSI', attribute_name: 'Brand' },
      'junk',
    ])
    expect(attributes).toHaveLength(2)
    expect(conditionOf(attributes)).toBe('used_like_new')
    expect(conditionOf([])).toBeNull()
    expect(attributesOf(null)).toEqual([])
  })
})

describe('linksExpireAt', () => {
  it('takes the earliest oe expiry the links carry', () => {
    const oe = (s: number) =>
      `https://scontent.example/x.jpg?stp=a&oe=${s.toString(16).toUpperCase()}&_nc=1`
    expect(linksExpireAt([oe(1790600000), oe(1790500000)], AT, 104)).toBe(
      new Date(1790500000 * 1000).toISOString(),
    )
  })

  it('otherwise 104 hours after collection; no links, no expiry', () => {
    expect(linksExpireAt(['https://redacted.invalid/media/a.jpg'], AT, 104)).toBe(
      '2026-09-28T09:40:43.415Z',
    )
    expect(linksExpireAt(['https://redacted.invalid/media/a.jpg'], AT, 103)).toBe(
      '2026-09-28T08:40:43.415Z',
    )
    expect(linksExpireAt([], AT, 104)).toBeNull()
  })
})

describe('readDetail', () => {
  it('skips a sourceOutcome row and a search card without details', () => {
    const outcome = rows.find((r) => r.recordType === 'sourceOutcome')
    expect(readDetail(outcome, 20, AT, 104)).toBeNull()
    const {
      detailAttempted: _a,
      descriptionStatus: _d,
      ...card
    } = rows[1] as Record<string, unknown>
    expect(readDetail(card, 1, AT, 104)).toBeNull()
  })

  it('records a removed ID as unresolved with no evidence, never as sold', () => {
    const detail = readDetail(
      {
        recordType: 'listing',
        listingId: '4704995303122642',
        detailAttempted: true,
        detailOutcome: 'extraction-error',
        directItemUnresolved: true,
      },
      0,
      AT,
      104,
    )
    expect(detail).toMatchObject({ unresolved: true, evidence: null, fetchedAt: AT })
  })

  it('flags a stale-cache row and keeps its evidence', () => {
    const detail = readDetail({ ...rows[1], detailCacheStatus: 'stale-fallback' }, 1, AT, 104)
    expect(detail?.staleFallback).toBe(true)
    expect(detail?.evidence).not.toBeNull()
  })

  it('reads a partial description as partial, and an unknown status as none', () => {
    expect(
      readDetail({ ...rows[1], descriptionStatus: 'partial' }, 1, AT, 104)?.descriptionStatus,
    ).toBe('partial')
    expect(
      readDetail({ ...rows[1], descriptionStatus: 'odd' }, 1, AT, 104)?.descriptionStatus,
    ).toBeNull()
  })

  it('drops seller conflicts and seller provenance', () => {
    const detail = readDetail(
      {
        ...rows[1],
        conflicts: [{ field: 'marketplace_listing_seller', detailValue: 1 }, { field: 'title' }],
        provenance: { seller: 'detail', title: 'search' },
      },
      1,
      AT,
      104,
    )
    expect(detail?.evidence?.conflicts).toEqual([{ field: 'title' }])
    expect(detail?.evidence?.provenance).toEqual({ title: 'search' })
  })

  it('keeps one fetch per listing per job: the first row wins', () => {
    const a = readDetail(rows[1], 1, AT, 104)
    const b = readDetail({ ...rows[1], description: 'later row' }, 5, AT, 104)
    if (!a || !b) throw new Error('not read')
    expect(firstPerListing([b, a])).toEqual([a])
  })
})
