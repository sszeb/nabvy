import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recompute } from '../../src/index'
import {
  ALL_ON,
  collectedAndRecorded,
  createTestDatabase,
  duplicateListing,
  loadRun,
  RECORDED,
  type TestDatabase,
} from '../support/database'

// Stage "clustering": the recorded run holds no copies (docs/design/drafts/copy-advert.md 4.13),
// so positive cases are synthetic, built by duplicating one of its rows (row 7, "Gaming PC" £2,500,
// a full_verified, 1,014-character description) to new listing IDs and city pages, per
// docs/design/modules/_rules.md rule 16 ("synthetic cases and what they are built from").

const BASE_ROW = 6 // row 7 (1-indexed), the £2,500 "Gaming PC" in Enfield.
const UNRELATED_DESCRIPTION = `${'Selling a lovely three-seater sofa in dark grey fabric, barely used, collection only from a '.repeat(
  3,
)}smoke-free home. No stains, no pets, comes from a clean flat near the station.`

// A fresh database per case (every case counts rows in empty tables). It is built in a hook
// with the timeout the other modules' fixture stages use: the fixtures CLI runs with Vitest's
// default 5 s test timeout, and PGlite startup plus nine modules' migrations is slow on a loaded
// runner.
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
}, 60_000)
afterEach(async () => {
  await t.close()
})

describe('copy-advert clustering', () => {
  it('the recorded run alone gives no links, no clusters and no flags (4.13 baseline)', async () => {
    const run = loadRun(RECORDED)
    const { listingIds } = await collectedAndRecorded(t, run)
    const result = await recompute(t.db, { listingIds })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.changedListingIds).toEqual([])
    const links = await t.asPipeline('select count(*)::int as n from copy_advert.links')
    const clusters = await t.asPipeline('select count(*)::int as n from copy_advert.clusters')
    const flags = await t.asPipeline('select count(*)::int as n from copy_advert.flags')
    expect(links[0]?.n).toBe(0)
    expect(clusters[0]?.n).toBe(0)
    expect(flags[0]?.n).toBe(0)
  })

  it('one advert copied to 5 city pages with the same price forms a mass-posted, would-show cluster', async () => {
    const run = loadRun(RECORDED)
    const source = run.dataset[BASE_ROW] as Record<string, unknown>
    const towns = ['Town Alpha', 'Town Beta', 'Town Gamma', 'Town Delta', 'Town Epsilon']
    const copies = towns.map((town, i) =>
      duplicateListing(source, {
        listingId: `900000000000${200 + i}`,
        cityPageId: `90000000010${i}`,
        location: town,
        listedAt: 1_790_000_000 + i * 86_400,
      }),
    )
    const { listingIds } = await collectedAndRecorded(t, run, copies)
    const result = await recompute(t.db, { listingIds })
    expect(result.ok).toBe(true)
    const clusters = await t.asPipeline(
      'select town_count, mass_posted from copy_advert.v_cluster_facts',
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.town_count).toBe(5)
    expect(clusters[0]?.mass_posted).toBe(true)
    const flags = await t.asPipeline(
      'select would_show, towns from copy_advert.flags where would_show',
    )
    expect(flags.length).toBeGreaterThan(0)
    for (const f of flags) expect(f.towns).toBeGreaterThanOrEqual(5)
  })

  it('copies that differ only in case, whitespace, punctuation or a phone number are still one cluster', async () => {
    const run = loadRun(RECORDED)
    const source = run.dataset[BASE_ROW] as Record<string, unknown>
    const copyA = duplicateListing(source, {
      listingId: '9000000000003001',
      cityPageId: '900000000031',
      location: 'Town One',
    })
    const copyB = duplicateListing(source, {
      listingId: '9000000000003002',
      cityPageId: '900000000032',
      location: 'Town Two',
      listedAt: 1_790_086_400,
    })
    // Case, whitespace and punctuation differences on the title still normalise to the same
    // key; description stays byte-identical, so desc_fp matches too (an equal desc_fp is
    // exact_text at any length, docs 4.4 S3). Phone-number masking (also part of "differ only
    // in ... a phone number") is covered at the domain level in test/domain.test.ts.
    copyB.title = `  ${String(source.title).toUpperCase()}!!  `
    const { listingIds } = await collectedAndRecorded(t, run, [copyA, copyB])
    const result = await recompute(t.db, { listingIds })
    expect(result.ok).toBe(true)
    const links = await t.asPipeline(
      "select basis from copy_advert.links where basis = 'exact_text'",
    )
    expect(links.length).toBeGreaterThan(0)
    const clusters = await t.asPipeline(
      'select count(*)::int as n from copy_advert.v_cluster_facts',
    )
    expect(clusters[0]?.n).toBe(1)
  })

  it('same title and price, different description splits as a look-alike (no cluster)', async () => {
    const run = loadRun(RECORDED)
    const source = run.dataset[BASE_ROW] as Record<string, unknown>
    const copyA = duplicateListing(source, {
      listingId: '9000000000004001',
      cityPageId: '900000000041',
      location: 'Town Look A',
    })
    const copyB = duplicateListing(source, {
      listingId: '9000000000004002',
      cityPageId: '900000000042',
      location: 'Town Look B',
    })
    copyB.description = UNRELATED_DESCRIPTION
    const { listingIds } = await collectedAndRecorded(t, run, [copyA, copyB])
    const result = await recompute(t.db, { listingIds })
    expect(result.ok).toBe(true)
    const links = await t.asPipeline('select basis from copy_advert.links')
    expect(links.map((l) => l.basis)).toEqual(['lookalike'])
    const clusters = await t.asPipeline(
      'select count(*)::int as n from copy_advert.v_cluster_facts',
    )
    expect(clusters[0]?.n).toBe(0)
  })

  it('the same text in GBP and EUR never forms a confirmed cluster', async () => {
    const run = loadRun(RECORDED)
    const source = run.dataset[BASE_ROW] as Record<string, unknown>
    const copyGbp = duplicateListing(source, {
      listingId: '9000000000005001',
      cityPageId: '900000000051',
      location: 'Town Currency A',
    })
    const copyEur = duplicateListing(source, {
      listingId: '9000000000005002',
      cityPageId: '900000000052',
      location: 'Town Currency B',
    }) as {
      money: { currency: string }
    }
    copyEur.money.currency = 'EUR'
    const { listingIds } = await collectedAndRecorded(t, run, [copyGbp, copyEur])
    const result = await recompute(t.db, { listingIds })
    expect(result.ok).toBe(true)
    const links = await t.asPipeline(
      "select basis from copy_advert.links where basis in ('exact_text', 'near_text')",
    )
    expect(links).toHaveLength(0)
  })

  it('£0 or free gives no price fingerprint at all', async () => {
    const run = loadRun(RECORDED)
    const source = run.dataset[BASE_ROW] as Record<string, unknown>
    const copyA = duplicateListing(source, {
      listingId: '9000000000006001',
      cityPageId: '900000000061',
      location: 'Town Free A',
    }) as {
      money: Record<string, unknown>
    }
    copyA.money = { kind: 'free', currency: 'GBP', amountMinor: 0, rawAmount: '0' }
    const copyB = duplicateListing(source, {
      listingId: '9000000000006002',
      cityPageId: '900000000062',
      location: 'Town Free B',
    }) as {
      money: Record<string, unknown>
    }
    copyB.money = { kind: 'free', currency: 'GBP', amountMinor: 0, rawAmount: '0' }
    const { listingIds } = await collectedAndRecorded(t, run, [copyA, copyB])
    const result = await recompute(t.db, { listingIds })
    expect(result.ok).toBe(true)
    const targetPrints = await t.asPipeline(
      `select advert_fp from copy_advert.prints where source_listing_id in ('9000000000006001', '9000000000006002')`,
    )
    expect(targetPrints).toHaveLength(2)
    expect(targetPrints.every((p) => p.advert_fp === null)).toBe(true)
  })

  it('a suppressed member drops out of the cluster and its own flag is hidden', async () => {
    const run = loadRun(RECORDED)
    const source = run.dataset[BASE_ROW] as Record<string, unknown>
    const towns = ['Sup A', 'Sup B', 'Sup C', 'Sup D', 'Sup E']
    // Each copy's description carries a unique marker so detail-evidence's exact fingerprint
    // differs per listing (listing-suppression's look-alike match is exact-fingerprint, so
    // suppressing one never cascades to the others through this route); the marker is a tiny
    // fraction of a 1,000+ character description, so copy-advert's own trigram similarity stays
    // comfortably above nearText and the five still link and cluster.
    const copies = towns.map((town, i) => {
      const row = duplicateListing(source, {
        listingId: `900000000000${300 + i}`,
        cityPageId: `90000000020${i}`,
        location: town,
      }) as {
        description: string
      }
      row.description = `${row.description} (ref ${i})`
      return row
    })
    const { listingIds } = await collectedAndRecorded(t, run, copies)
    await recompute(t.db, { listingIds })

    const { add } = await import('@nabvy/listing-suppression')
    const target = await t.asPipeline(
      `select id::text as id from listing_ingest.v_listings where source_listing_id = $1`,
      ['900000000000300'],
    )
    const listingId = String(target[0]?.id)
    const addResult = await add(t.db, {
      requestId: '00000000-0000-7000-9000-000000000001',
      listings: [{ source: 'facebook', sourceListingId: '900000000000300' }],
      sellerKeys: [],
    })
    expect(addResult.ok).toBe(true)
    const result = await recompute(t.db, { listingIds })
    expect(result.ok).toBe(true)
    const flagRows = await t.asPipeline(
      'select listing_id from copy_advert.flags where listing_id = $1',
      [listingId],
    )
    expect(flagRows).toHaveLength(0)
    const facts = await t.asPipeline('select listing_count from copy_advert.v_cluster_facts')
    expect(facts[0]?.listing_count).toBe(4)
  })
})
