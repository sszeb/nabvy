import { createEvent } from '@nabvy/contracts'
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentRuleVersion, detailEvidenceChangedHandler, run } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  RECORDED,
  type TestDatabase,
  withFields,
} from './support/database'

// Idempotency on (listing, evidence hash, rule version): a replayed batch writes nothing and
// returns the same event key; a new version of one listing runs that listing only.

const recorded = loadRun(RECORDED)
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const counts = async () => {
  const [row] = await t.sql(
    `select (select count(*)::int from parts_rules.runs) as runs,
            (select count(*)::int from parts_rules.rule_parts) as parts,
            (select max(updated_at) from parts_rules.runs) as touched`,
  )
  return row
}

describe('idempotency', () => {
  it('a second run of the same batch writes nothing and returns the same event key', async () => {
    const listingIds = await detailed(t, recorded)
    const first = await run(t.db, { listingIds })
    const after = await counts()
    const second = await run(t.db, { listingIds: [...listingIds].reverse() })
    if (!first.ok || !second.ok) throw new Error('run failed')
    expect(first.value).toMatchObject({ runsWritten: 20, listings: 20 })
    expect(first.value.partsWritten).toBe(after?.parts)
    expect(second.value).toMatchObject({ runsWritten: 0, partsWritten: 0, listings: 20 })
    expect(await counts()).toEqual(after)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(second.value.ran).toEqual(first.value.ran)
  })

  it('a new version of one listing runs that listing only, under a new key', async () => {
    const listingIds = await detailed(t, recorded)
    const first = await run(t.db, { listingIds })
    const edited = withFields(recorded.dataset, '1756692548940192', {
      collectedAt: '2026-09-25T00:00:00.000Z',
      description: 'Now with an RTX 3060 12GB and 16GB DDR4 RAM.',
    })
    const changed = await detailed(t, recorded, edited)
    expect(changed).toHaveLength(1)
    const second = await run(t.db, { listingIds: changed })
    if (!first.ok || !second.ok) throw new Error('run failed')
    expect(second.value.runsWritten).toBe(1)
    expect(second.value.events[0]?.key).not.toBe(first.value.events[0]?.key)
    const [row] = await t.asPipeline(
      `select count(*)::int as n from parts_rules.v_gaps where listing_id = $1`,
      [changed[0]],
    )
    expect(row?.n).toBe(2)
  })

  it('the rule version is part of the key, and follows the catalogue negatives in force', async () => {
    const listingIds = await detailed(t, recorded)
    const on = await run(t.db, { listingIds })
    const [row] = await t.sql('select distinct rule_version from parts_rules.runs')
    expect(row?.rule_version).toBe(await currentRuleVersion(t.db))
    expect(on.ok && on.value.ruleVersion).toBe(row?.rule_version)

    // With product-catalogue off its negative contexts are not in force: a new version, and the
    // same listings run again (and again once it is back on, under the first version: nothing new).
    await t.switches({ 'product-catalogue': 'off' })
    const off = await run(t.db, { listingIds })
    if (!on.ok || !off.ok) throw new Error('run failed')
    expect(off.value.ruleVersion).not.toBe(on.value.ruleVersion)
    expect(off.value.runsWritten).toBe(20)
    await t.switches({ 'product-catalogue': 'on' })
    const back = await run(t.db, { listingIds })
    expect(back.ok && back.value.runsWritten).toBe(0)
  })

  it('the handler publishes once; a redelivery publishes nothing new', async () => {
    const listingIds = await detailed(t, recorded)
    const publisher = createMemoryPublisher()
    const handler = detailEvidenceChangedHandler({ transaction: (fn) => t.db.transaction(fn) })
    const envelope = createEvent(
      detailEvidenceEvents,
      'detail-evidence.changed',
      1,
      { listingIds },
      { key: 'detail-evidence.changed:1:0' },
    )
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-24T02:00:00.000Z' }
    const deps = { publisher, deadLetters: { record: async () => ({}) } }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('parts-rules.ran')).toHaveLength(1)
    expect(publisher.published[0]?.payload).toEqual({ listingIds: expect.any(Array) })
    expect(publisher.duplicates).toHaveLength(1)
    expect(await counts()).toMatchObject({ runs: 20 })
  })

  it('a batch over 500 listing IDs is refused before reading anything', async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    )
    const result = await run(t.db, { listingIds: ids })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('parts-rules.too_many_listings')
  })

  it('listings with no current version are skipped', async () => {
    const result = await run(t.db, { listingIds: ['00000000-0000-7000-8000-000000000001'] })
    expect(result).toMatchObject({ ok: true, value: { listings: 0, runsWritten: 0, events: [] } })
  })
})
