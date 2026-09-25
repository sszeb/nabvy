import { createEvent } from '@nabvy/contracts'
import {
  events,
  module,
  PastedLinkLookupError,
  PastedLinkLookupReadyEvent,
  PastedLinkLookupRequest,
  PastedLinkLookupRequestCount,
  PastedLinkLookupSubmitInput,
} from '@nabvy/contracts/modules/pasted-link-lookup'
import { describe, expect, it } from 'vitest'
import { readyKey } from '../src/domain'

// Every schema in @nabvy/contracts/modules/pasted-link-lookup parses its documented shape and
// refuses the obvious bad input (rule 16 of docs/design/modules/_rules.md).

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const R1 = '0190f1d2-0000-7000-8000-0000000000c1'
const L1 = '0190f1d2-0000-7000-8000-0000000000a1'

describe('pasted-link-lookup contracts', () => {
  it('declares its name', () => {
    expect(module).toBe('pasted-link-lookup')
    expect(events.module).toBe('pasted-link-lookup')
  })

  it('bounds the form input: a user and a link of at most 2048 characters, nothing else', () => {
    expect(PastedLinkLookupSubmitInput.safeParse({ userId: U1, url: 'x' }).success).toBe(true)
    expect(PastedLinkLookupSubmitInput.safeParse({ userId: U1, url: '' }).success).toBe(false)
    expect(
      PastedLinkLookupSubmitInput.safeParse({ userId: U1, url: 'a'.repeat(2049) }).success,
    ).toBe(false)
    expect(
      PastedLinkLookupSubmitInput.safeParse({ userId: U1, url: 'x', requestedAt: 'now' }).success,
    ).toBe(false)
    expect(
      PastedLinkLookupSubmitInput.safeParse({ userId: U1, url: 'x', sourceListingId: '1' }).success,
    ).toBe(false)
  })

  it('parses a user-facing request row and refuses a seller or text column', () => {
    const row = {
      requestId: R1,
      source: 'facebook',
      sourceListingId: '12345678901234567',
      listingId: L1,
      status: 'ready',
      requestedAt: '2026-09-25T12:00:00.000Z',
      readyAt: '2026-09-25T12:00:01.000Z',
    }
    expect(PastedLinkLookupRequest.parse(row)).toEqual(row)
    expect(PastedLinkLookupRequest.safeParse({ ...row, status: 'done' }).success).toBe(false)
    expect(PastedLinkLookupRequest.safeParse({ ...row, sourceListingId: 'abc' }).success).toBe(
      false,
    )
    expect(PastedLinkLookupRequest.safeParse({ ...row, sellerName: 'x' }).success).toBe(false)
    expect(PastedLinkLookupRequest.safeParse({ ...row, title: 'x' }).success).toBe(false)
  })

  it('parses an internal request-count row', () => {
    expect(PastedLinkLookupRequestCount.parse({ userId: U1, day: '2026-09-25', n: 3 })).toEqual({
      userId: U1,
      day: '2026-09-25',
      n: 3,
    })
    expect(PastedLinkLookupRequestCount.safeParse({ userId: U1, day: 'x', n: 3 }).success).toBe(
      false,
    )
  })

  it('the ready event carries request IDs only, 1-500, and never text (rule 7)', () => {
    expect(PastedLinkLookupReadyEvent.safeParse({ requestIds: [R1] }).success).toBe(true)
    expect(PastedLinkLookupReadyEvent.safeParse({ requestIds: [] }).success).toBe(false)
    expect(PastedLinkLookupReadyEvent.safeParse({ requestIds: Array(501).fill(R1) }).success).toBe(
      false,
    )
    expect(PastedLinkLookupReadyEvent.safeParse({ requestIds: [R1], title: 'x' }).success).toBe(
      false,
    )
    const envelope = createEvent(
      events,
      'pasted-link-lookup.ready',
      1,
      { requestIds: [R1] },
      { key: readyKey([R1]) },
    )
    expect(envelope.type).toBe('pasted-link-lookup.ready')
    expect(envelope.key).toBe(readyKey([R1]))
  })

  it('error codes are values with a message', () => {
    expect(
      PastedLinkLookupError.safeParse({ code: 'pasted-link-lookup.invalid_link', message: 'no' })
        .success,
    ).toBe(true)
    expect(PastedLinkLookupError.safeParse({ code: 'other.code', message: 'no' }).success).toBe(
      false,
    )
  })
})
