import { createEvent, parseEvent } from '@nabvy/contracts'
import {
  events,
  PickupLocationArea,
  PickupLocationEvidence,
  PickupLocationOutput,
  PickupLocationUserRow,
} from '@nabvy/contracts/modules/pickup-location'
import { describe, expect, it } from 'vitest'

// Events and view rows parse with @nabvy/contracts/modules/pickup-location; the model output
// schema is strict and price-free.

const ID = '00000000-0000-7000-8000-000000000001'

describe('contracts', () => {
  it('publishes thin events: listing IDs only, at most 500', () => {
    const key = { key: 'pickup-location.resolved:r1.00000000:0:0' }
    const envelope = createEvent(events, 'pickup-location.resolved', 1, { listingIds: [ID] }, key)
    expect(parseEvent(events, envelope).type).toBe('pickup-location.resolved')
    expect(() =>
      createEvent(
        events,
        'pickup-location.changed',
        1,
        { listingIds: [ID], text: 'x' } as never,
        key,
      ),
    ).toThrow()
    expect(() =>
      createEvent(events, 'pickup-location.changed', 1, { listingIds: Array(501).fill(ID) }, key),
    ).toThrow()
  })

  it('a user-facing row carries a district at most, never a full postcode, and no seller field', () => {
    const row = {
      listingId: ID,
      townOrArea: 'Bognor Regis',
      approximate: true,
      areaId: 'cp:108540552503171',
      areaDistrict: 'PO21',
      areaLandmass: null,
      status: 'from_description',
      source: 'description',
      noteCode: 'description_says_collection_from',
      notePlaceLabel: 'Bognor Regis',
      listedInLabel: 'Chichester',
      lat: 50.798,
      lng: -0.6207,
      uncertaintyKm: null,
      collection: 'yes',
      meetupOffered: false,
      localDelivery: 'none',
      postage: 'text',
    }
    expect(PickupLocationUserRow.parse(row)).toEqual(row)
    expect(PickupLocationUserRow.safeParse({ ...row, areaDistrict: 'PO21 1AA' }).success).toBe(
      false,
    )
    expect(PickupLocationUserRow.safeParse({ ...row, sellerName: 'x' }).success).toBe(false)
  })

  it('internal rows parse', () => {
    expect(
      PickupLocationArea.parse({
        listingId: ID,
        townOrArea: null,
        approximate: true,
        conflict: false,
        basis: 'fallback',
        status: 'unknown',
      }),
    ).toBeTruthy()
    expect(
      PickupLocationEvidence.parse({
        listingId: ID,
        pass: 'detail',
        evidenceHash: 'a'.repeat(64),
        ruleVersion: 'r1.0123abcd',
        kind: 'mention',
        seq: 0,
        role: 'pickup',
        cue: 'Collection from',
        strength: 'strong',
        label: null,
        rejection: null,
        quote: 'Collection from PO21 ***',
        source: 'description',
        start: 10,
        end: 18,
      }),
    ).toBeTruthy()
  })

  it('model output is facts and text only, strict', () => {
    expect(
      PickupLocationOutput.parse({
        answer: 'text_place',
        place: 'Bognor',
        role: 'pickup',
        quote: 'collection from Bognor',
        confidence: 'high',
      }),
    ).toBeTruthy()
    expect(
      PickupLocationOutput.safeParse({
        answer: 'text_place',
        place: 'Bognor',
        role: 'pickup',
        quote: 'x',
        confidence: 'high',
        lat: 50,
      }).success,
    ).toBe(false)
    expect(
      PickupLocationOutput.safeParse({
        answer: 'text_place',
        place: 'Bognor',
        role: 'pickup',
        quote: 'x',
        confidence: 0.9,
      }).success,
    ).toBe(false)
  })
})
