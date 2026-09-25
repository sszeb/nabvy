import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listCentres, listCityPages, reconcileSeen, verify } from '../src'
import { CityPagesRefused } from '../src/domain'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const CANDIDATE = '110092169012550'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('idempotency', () => {
  it('reconcileSeen run twice on the same batch adds the new page once', async () => {
    await t.seenListing({
      sourceListingId: '1',
      cityPageId: 'repeat-page',
      townLabel: 'Repeat Town',
    })
    const first = await reconcileSeen(t.db)
    expect(first.event).toHaveLength(1)
    expect(first.event[0]?.payload).toEqual({ cityPageIds: ['repeat-page'] })

    const second = await reconcileSeen(t.db)
    expect(second.event).toEqual([])

    const pages = await listCityPages(t.db)
    expect(pages.filter((p) => p.cityPageId === 'repeat-page')).toHaveLength(1)
  })

  it('verify run twice for the same job refuses the second call and writes nothing more', async () => {
    await t.searchOutcome({
      jobId: 42,
      searchIndex: 0,
      centreId: CANDIDATE,
      kind: 'newest',
      status: 'complete',
      controlLatitude: 51.08,
      controlLongitude: 1.16,
    })
    const first = await verify(t.db, { cityPageId: CANDIDATE, jobId: 42, actorUserId: ADMIN })
    expect(first.event).toHaveLength(1)

    await expect(
      verify(t.db, { cityPageId: CANDIDATE, jobId: 42, actorUserId: ADMIN }),
    ).rejects.toBeInstanceOf(CityPagesRefused)
    await expect(
      verify(t.db, { cityPageId: CANDIDATE, jobId: 42, actorUserId: ADMIN }),
    ).rejects.toMatchObject({ code: 'city-pages.already_verified' })

    const centres = await listCentres(t.db)
    const centre = centres.find((c) => c.cityPageId === CANDIDATE)
    expect(centre).toMatchObject({ verified: true, reportedLat: 51.08, reportedLng: 1.16 })

    const [row] = await t.sql(
      "select count(*)::int as n from audit_log.entries where target = $1 and action = 'city-pages.verified'",
      [`city-page:${CANDIDATE}`],
    )
    expect(row?.n).toBe(1)
  })
})
