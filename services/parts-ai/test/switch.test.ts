import { PARTS_AI_DAILY_SPEND_CAP_GBP_MICROS } from '@nabvy/config/modules/parts-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyCorrection,
  createRecordedPartsClient,
  erase,
  PARTS_AI_PROMPT_VERSION,
  run,
  sweep,
} from '../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  openThrottle,
  RECORDED,
  type TestDatabase,
  USD_GBP_RATE,
  withFields,
} from './support/database'
import { loadRecording, recordedClient } from './support/model'

// Switch states (rule 11) and the fail-closed checks before paid work (rule 13): quote-redaction,
// cost-meter, the provider switch, the price table, the spend-governor throttle and the day's
// cap. What stops paid work defers the listings to the sweep; nothing is lost.

const recorded = loadRun(RECORDED)
const responses = loadRecording('current').responses
const ctx = { usdGbpRate: USD_GBP_RATE }
let t: TestDatabase
let listingIds: string[]
let client: Awaited<ReturnType<typeof recordedClient>>
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await openThrottle(t)
  listingIds = await detailed(t, recorded)
  client = await recordedClient(t, responses)
})
afterEach(async () => {
  await t.close()
})

const count = async (table: string) =>
  Number((await t.sql(`select count(*)::int as n from parts_ai.${table}`))[0]?.n)
const viewRows = async () =>
  Number(
    (
      await t.asPipeline(
        `select (select count(*) from parts_ai.v_runs) + (select count(*) from parts_ai.v_ai_parts)
           + (select count(*) from parts_ai.v_quarantine) as n`,
      )
    )[0]?.n,
  )

describe('switch states', () => {
  it('off: acknowledges, calls nothing, writes nothing; the views are empty', async () => {
    await run(t.db, { listingIds }, { client }, ctx)
    await t.switches({ 'parts-ai': 'off' })
    const result = await run(t.db, { listingIds }, { client: await recordedClient(t, {}) }, ctx)
    expect(result).toMatchObject({ ok: true, value: { open: false, called: 0, events: [] } })
    expect(await viewRows()).toBe(0)
    expect(await count('calls')).toBe(12)
  })

  it('a paused pipeline calls nothing', async () => {
    await t.switches({ pipeline: 'off' })
    const result = await run(t.db, { listingIds }, { client }, ctx)
    expect(result).toMatchObject({ ok: true, value: { open: false, called: 0 } })
    expect(client.calls).toHaveLength(0)
  })

  it('shadow runs and writes, and the internal views show rows', async () => {
    await t.switches({ 'parts-ai': 'shadow' })
    const result = await run(t.db, { listingIds }, { client }, ctx)
    expect(result).toMatchObject({ ok: true, value: { called: 12 } })
    expect(await viewRows()).toBeGreaterThan(0)
  })

  it('parts-rules or detail-evidence off: no gaps to read, nothing called', async () => {
    for (const off of ['parts-rules', 'detail-evidence']) {
      await t.switches({ ...ALL_ON, [off]: 'off' })
      const result = await run(t.db, { listingIds }, { client }, ctx)
      expect(result).toMatchObject({ ok: true, value: { openVersions: 0, called: 0 } })
    }
    expect(client.calls).toHaveLength(0)
  })

  it('product-catalogue off: parts are stored with no catalogue ID, never a guess', async () => {
    await t.switches({ 'product-catalogue': 'off' })
    await run(t.db, { listingIds }, { client }, ctx)
    const rows = await t.asPipeline('select catalogue_id from parts_ai.v_ai_parts')
    expect(rows.length).toBe(8)
    expect(rows.every((r) => r.catalogue_id === null)).toBe(true)
  })
})

describe('paid work fails closed', () => {
  const paused = async (reason: string) => {
    const result = await run(t.db, { listingIds }, { client }, ctx)
    expect(result).toMatchObject({ ok: true, value: { paused: reason, called: 0 } })
    if (result.ok) expect(result.value.deferred).toHaveLength(12)
    expect(client.calls).toHaveLength(0)
    expect(await count('calls')).toBe(0)
  }

  it('quote-redaction not on (off or shadow): no listing text goes to a model', async () => {
    await t.switches({ 'quote-redaction': 'off' })
    await paused('quote-redaction-off')
    await t.switches({ 'quote-redaction': 'shadow' })
    await paused('quote-redaction-off')
  })

  it('cost-meter off', async () => {
    await t.switches({ 'cost-meter': 'off' })
    await paused('cost-meter-off')
  })

  it('the provider switch off', async () => {
    await t.switches({ anthropic: 'off' })
    await paused('provider-off')
  })

  it('an unpriced model', async () => {
    client = createRecordedPartsClient('unpriced-model', {
      promptVersion: PARTS_AI_PROMPT_VERSION,
      responses: {},
    }) as typeof client
    await paused('unknown-model')
  })

  it('the throttle not open: never computed (hold-new), or slow-paid', async () => {
    await t.sql('delete from spend_governor.throttle')
    await paused('throttled')
    await openThrottle(t)
    await t.sql(`update spend_governor.throttle set level = 'slow-paid'`)
    await paused('throttled')
  })

  it("the day's cap: calls stop before the one that would pass it; older spend does not count", async () => {
    await t.sql(
      `insert into parts_ai.calls (listing_id, evidence_hash, prompt_version, model, trace_id,
         cost_gbp_micros, status, done_at)
       values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'p1.00000000', 'm', 'old',
               $1, 'extracted', now() - interval '25 hours'),
              ('01920000-0000-7000-8000-000000000002', repeat('a', 64), 'p1.00000000', 'm', 'new',
               $2, 'extracted', now() - interval '1 hour')`,
      [PARTS_AI_DAILY_SPEND_CAP_GBP_MICROS, PARTS_AI_DAILY_SPEND_CAP_GBP_MICROS - 10_000],
    )
    const result = await run(t.db, { listingIds }, { client }, ctx)
    if (!result.ok) throw new Error('run failed')
    // Each estimate (2,500 in, 1,200 out at the recorded model's price) is about 6,375 GBP micros.
    expect(result.value.called).toBeGreaterThan(0)
    expect(result.value.called).toBeLessThan(12)
    expect(result.value.called + result.value.deferred.length).toBe(12)
    const [spent] = await t.sql(
      `select sum(cost_gbp_micros)::bigint as n from parts_ai.calls where done_at > now() - interval '24 hours'`,
    )
    expect(Number(spent?.n)).toBeLessThanOrEqual(PARTS_AI_DAILY_SPEND_CAP_GBP_MICROS)
  })

  it('deferred listings are picked up by the sweep once work may resume', async () => {
    await t.switches({ anthropic: 'off' })
    await run(t.db, { listingIds }, { client }, ctx)
    await t.switches({ anthropic: 'on' })
    const swept = await sweep(t.db, { client }, ctx)
    expect(swept).toMatchObject({ ok: true, value: { called: 12, extracted: 12 } })
    const again = await sweep(t.db, { client }, ctx)
    expect(again).toMatchObject({ ok: true, value: { openVersions: 0, called: 0 } })
  })

  it('a call that throws writes nothing for that listing; the sweep tries it again', async () => {
    const partial = { ...responses }
    delete partial['1073353648648306']
    const flaky = await recordedClient(t, partial)
    const result = await run(t.db, { listingIds }, { client: flaky }, ctx)
    expect(result).toMatchObject({ ok: true, value: { called: 11 } })
    if (result.ok) expect(result.value.failed).toHaveLength(1)
    expect(await count('calls')).toBe(11)
    const swept = await sweep(t.db, { client }, ctx)
    expect(swept).toMatchObject({ ok: true, value: { called: 1 } })
  })

  it('every call is metered through cost-meter under this module', async () => {
    await run(t.db, { listingIds }, { client }, ctx)
    const rows = await t.sql(
      `select c.trace_id, m.module, m.kind, m.settled_gbp_micros, c.cost_gbp_micros
       from parts_ai.calls c join cost_meter.provider_calls m on m.ref_id = c.trace_id`,
    )
    expect(rows).toHaveLength(12)
    for (const row of rows) {
      expect(row).toMatchObject({ module: 'parts-ai' })
      expect(Number(row.cost_gbp_micros)).toBe(Number(row.settled_gbp_micros))
    }
  })
})

describe('what reaches the model', () => {
  it('a masked copy of the text, never the stored one; no listing ID, only the evidence hash as trace key', async () => {
    const rows = withFields(recorded.dataset, '1380502417485603', {
      collectedAt: '2026-09-25T00:00:00.000Z',
      description: 'Specs are in video. Call 07700 900123 or email seller@example.com',
    })
    const changed = await detailed(t, { ...recorded, apifyRunId: `${recorded.apifyRunId}-2` }, rows)
    const spy = await recordedClient(t, responses)
    await run(t.db, { listingIds: changed }, { client: spy }, ctx)
    const [call] = spy.calls
    expect(call?.userMessage).not.toContain('07700 900123')
    expect(call?.userMessage).not.toContain('seller@example.com')
    expect(call?.userMessage).not.toContain(changed[0])
    expect(call?.traceKey).toMatch(/^[0-9a-f]{64}$/)
    const [stored] = await t.asPipeline(
      'select description from detail_evidence.v_text where listing_id = $1 and evidence_hash = $2',
      [changed[0], call?.traceKey],
    )
    expect(stored?.description).toContain('07700 900123')
  })
})

describe('corrections and erasure', () => {
  it('a correction sits beside the AI part; an unknown part is refused', async () => {
    await run(t.db, { listingIds }, { client }, ctx)
    const [part] = await t.asPipeline(
      'select listing_id, evidence_hash, prompt_version, seq from parts_ai.v_ai_parts limit 1',
    )
    const correction = {
      listingId: part?.listing_id as string,
      evidenceHash: part?.evidence_hash as string,
      promptVersion: part?.prompt_version as string,
      seq: part?.seq as number,
      inclusion: 'mention' as const,
      by: '01920000-0000-7000-8000-00000000000a',
      reason: 'The seller keeps this card.',
    }
    expect(await applyCorrection(t.db, correction)).toEqual({ ok: true, value: { applied: true } })
    const [row] = await t.asPipeline(
      'select inclusion, correction from parts_ai.v_ai_parts where listing_id = $1 and seq = $2',
      [correction.listingId, correction.seq],
    )
    expect(row?.inclusion).toBe('offered')
    expect(row?.correction).toMatchObject({
      inclusion: 'mention',
      reason: 'The seller keeps this card.',
    })
    const missing = await applyCorrection(t.db, { ...correction, seq: 99 })
    expect(missing).toMatchObject({ ok: false, error: { code: 'parts-ai.part_not_found' } })
  })

  it('erase removes every call, part, quarantine row and refresh of the listings', async () => {
    await run(t.db, { listingIds }, { client }, ctx)
    expect(await erase(t.db, listingIds)).toBe(12)
    for (const table of ['calls', 'ai_parts', 'quarantine', 'refreshes']) {
      expect(await count(table)).toBe(0)
    }
  })
})
