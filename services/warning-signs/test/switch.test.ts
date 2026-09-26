import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluate } from '../src'
import {
  createTestDatabase,
  seed,
  setSwitch,
  switchOn,
  type TestDatabase,
  UPSTREAM,
} from './support/database'

// Rule 11: off writes nothing and both views are empty; shadow writes and fills the internal view
// only; on shows the user-facing codes. listing-suppression off or a suppressed listing hides
// every row; quote-redaction off keeps the fact and drops the quote; nabvy_app reads no more than
// the view.

const ID = '00000000-0000-4000-8005-000000000001'
const OTHER = '00000000-0000-4000-8005-000000000002'
const TEXT = 'Sold as seen, call 07700 900123. Payment upfront by bank transfer please.'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await switchOn(t, UPSTREAM)
  await seed(t, [
    { id: ID, description: TEXT, cautions: [] },
    { id: OTHER, description: 'Ex mining card, repasted and running cool at load.', cautions: [] },
  ])
})
afterEach(async () => {
  await t.close()
})

const run = () =>
  t.as('nabvy_pipeline', (q) => evaluate(q, { listingIds: [ID, OTHER], now: new Date() }))
const internal = () => t.sqlAs('nabvy_pipeline', 'select * from warning_signs.v_facts')
const shown = () =>
  t.sqlAs(
    'nabvy_app',
    'select listing_id, code, evidence_text from app.v_warning_signs order by 1, 2',
  )
const stored = async () =>
  Number((await t.sql('select count(*) as n from warning_signs.evaluations'))[0]?.n)

describe('switch', () => {
  it('off: nothing is read or written, and both views are empty', async () => {
    const r = await run()
    expect(r.ok && r.value.open).toBe(false)
    expect(r.ok && r.value.events).toEqual([])
    expect(await stored()).toBe(0)
    expect(await internal()).toEqual([])
    expect(await shown()).toEqual([])
  })

  it('the paused pipeline writes nothing', async () => {
    await setSwitch(t, 'on')
    await setSwitch(t, 'off', 'pipeline')
    await run()
    expect(await stored()).toBe(0)
  })

  it('shadow: facts are written and internal, nothing is shown', async () => {
    await setSwitch(t, 'shadow')
    await run()
    expect(await stored()).toBe(2)
    expect((await internal()).length).toBeGreaterThan(0)
    expect(await shown()).toEqual([])
    await setSwitch(t, 'off')
    expect(await internal()).toEqual([])
  })

  it('on: the user-facing codes, with their redacted quotes', async () => {
    await setSwitch(t, 'on')
    await run()
    expect(await shown()).toEqual([
      {
        listing_id: ID,
        code: 'pay_first_text',
        evidence_text: 'Payment upfront by bank transfer please',
      },
      { listing_id: ID, code: 'untested_text', evidence_text: 'Sold as seen' },
      { listing_id: OTHER, code: 'mining_text', evidence_text: 'Ex mining card' },
    ])
    const codes = (await internal()).map((r) => r.code)
    expect(codes).toContain('off_platform_contact_text')
    const contact = (await internal()).find((r) => r.code === 'off_platform_contact_text')
    expect(JSON.stringify(contact?.evidence)).not.toContain('07700')
  })

  it('quote-redaction off: the fact shows without its quote', async () => {
    await setSwitch(t, 'on')
    await setSwitch(t, 'off', 'quote-redaction')
    await run()
    const rows = await shown()
    expect(rows.length).toBe(3)
    for (const r of rows) expect(r.evidence_text).toBeNull()
  })

  it('listing-suppression off hides every row; a suppressed listing never shows', async () => {
    await setSwitch(t, 'on')
    await run()
    await setSwitch(t, 'off', 'listing-suppression')
    expect(await shown()).toEqual([])
    await setSwitch(t, 'on', 'listing-suppression')
    await t.sql(
      `insert into listing_suppression.entries (kind, value, request_id)
       select 'listing_hash', listing_suppression.listing_hash(source, source_listing_id),
              '01920000-0000-7000-8000-000000000001'
       from listing_ingest.listings where id = $1`,
      [ID],
    )
    expect((await shown()).map((r) => r.listing_id)).toEqual([OTHER])
  })

  it('nabvy_app reads no more than the view from the tables', async () => {
    await setSwitch(t, 'on')
    await run()
    const facts = await t.sqlAs('nabvy_app', 'select code from warning_signs.facts order by 1')
    expect(facts.map((r) => r.code)).toEqual(['mining_text', 'pay_first_text', 'untested_text'])
    await expect(t.sqlAs('nabvy_app', 'select evidence from warning_signs.facts')).rejects.toThrow(
      /permission denied/,
    )
    await setSwitch(t, 'shadow')
    expect(await t.sqlAs('nabvy_app', 'select id from warning_signs.evaluations')).toEqual([])
  })
})
