import { describe, expect, it } from 'vitest'
import {
  buildGazetteer,
  type Candidate,
  candidatesFrom,
  classifyCue,
  decide,
  districtOf,
  extractMentions,
  fieldFrom,
  handoverFrom,
  ruleVersion,
  type Thresholds,
} from '../src/domain'

// Pure rules: the gazetteer, cues, postcode handling, the decision table at its thresholds and
// the handover facts. Points are synthetic: Chichester (0, 0), Bognor 15 km east, Leeds 300 km
// north; one degree of longitude at the equator is about 111 km.

const T: Thresholds = {
  agreeKm: 10,
  conflictKm: 25,
  deliveryFarKm: 100,
  cueWindowChars: 40,
  maxCandidates: 20,
}
const KM = 1 / 111.2
const PAGES = [
  { cityPageId: 'p-chi', name: 'Chichester, West Sussex', towns: ['Selsey'], lat: 0, lng: 0 },
  { cityPageId: 'p-bog', name: 'Bognor Regis', towns: ['Bognor'], lat: 0, lng: 15 * KM },
  { cityPageId: 'p-leeds', name: 'Leeds', towns: ['Headingley'], lat: 300 * KM, lng: 0 },
  { cityPageId: 'p-read', name: 'Reading', towns: [], lat: 0, lng: 60 * KM },
  { cityPageId: 'p-nopt', name: 'Abberley', towns: [], lat: null, lng: null },
]
const G = buildGazetteer(PAGES)
const NO_POSTCODES = new Map()

function resolve(
  text: string,
  field: {
    cityPageId: string | null
    townLabel: string | null
    coordinates?: { lat: number; lng: number } | null
  },
  pass: 'card' | 'detail' = 'detail',
  postcodes = NO_POSTCODES,
) {
  const f = fieldFrom({ coordinates: null, ...field }, G)
  const mentions = extractMentions('description', text, G, T)
  const candidates: Candidate[] = candidatesFrom(mentions, postcodes, f, G, T)
  return { decision: decide(pass, f, candidates, T), candidates, field: f }
}

describe('gazetteer', () => {
  it('names a page by the part before the comma and each town at the page point', () => {
    expect(G.byPage.get('p-chi')?.label).toBe('Chichester')
    expect(G.byName.get('selsey')?.[0]?.areaId).toBe('town:p-chi:selsey')
    expect(G.byName.get('selsey')?.[0]?.point).toEqual({ lat: 0, lng: 0 })
    expect(G.byName.get('chichester, west sussex')?.[0]?.areaId).toBe('cp:p-chi')
  })
})

describe('cues', () => {
  it.each([
    ['Collection from ', 'pickup', 'strong'],
    ['Available for collection only in ', 'pickup', 'strong'],
    ['Pick up from ', 'pickup', 'strong'],
    ['Based in ', 'seller_base', 'strong'],
    ["I'm in ", 'seller_base', 'strong'],
    ['Can deliver to ', 'delivery_area', 'strong'],
    ['Happy to meet in ', 'meetup', 'medium'],
    ['near ', 'near', 'medium'],
    ['Bought in ', 'origin', 'strong'],
    ['Selling my PC in ', 'pickup', 'medium'],
    ['Gaming PC ', 'mention', 'weak'],
  ])('"%s<place>" is %s (%s)', (before, role, strength) => {
    expect(classifyCue(before, '')).toMatchObject({ role, strength })
  })

  it('reads "area" after the place as the seller base', () => {
    expect(classifyCue('', ' area, no posting')).toMatchObject({ role: 'seller_base' })
  })
})

describe('mentions', () => {
  it('finds places, full postcodes and cued districts, in text order', () => {
    const m = extractMentions(
      'description',
      'Collection from Bognor, PO21 1AA. Can deliver to Leeds. Not RTX 3090.',
      G,
      T,
    )
    expect(m.map((x) => [x.kind, x.value, x.role])).toEqual([
      ['place', 'Bognor', 'pickup'],
      ['postcode_full', 'PO21 1AA', 'seller_base'],
      ['place', 'Leeds', 'delivery_area'],
    ])
  })

  it('rejects a stop-listed word without a cue and keeps it with one', () => {
    const bare = extractMentions('description', 'Good for reading emails.', G, T)
    expect(bare.map((x) => x.rejection)).toEqual(['stop_list'])
    const cued = extractMentions('description', 'Collection from Reading.', G, T)
    expect(cued.map((x) => x.rejection)).toEqual([null])
  })

  it('rejects mentions inside a hashtag block', () => {
    const m = extractMentions('description', 'RTX 3090.\n#leeds #bognor #chichester #pc', G, T)
    expect(m.length).toBeGreaterThan(0)
    expect(m.every((x) => x.rejection === 'tag_block')).toBe(true)
  })

  it('never reads a GPU model as a postcode district', () => {
    expect(extractMentions('title', 'RTX 3090 24GB, i9 13900K', G, T)).toEqual([])
  })

  it('shows a lettered sub-district as its parent', () => {
    expect(districtOf('SW1A')).toBe('SW1')
    expect(districtOf('PO21')).toBe('PO21')
  })
})

describe('decision table', () => {
  it('a text place at the field: confirmed, source both', () => {
    const { decision } = resolve('Collection from Selsey.', {
      cityPageId: 'p-chi',
      townLabel: 'Chichester',
    })
    expect(decision).toMatchObject({ status: 'confirmed', conflict: false, approximate: false })
    expect(decision.display?.label).toBe('Selsey')
  })

  it('10 km agrees; 15 km is from the description with a recorded conflict; 25 km is the edge', () => {
    const near = resolve('Collection from Bognor.', {
      cityPageId: 'p-chi',
      townLabel: 'Chichester',
      coordinates: { lat: 0, lng: 5 * KM },
    })
    expect(near.decision.status).toBe('confirmed')
    const mid = resolve('Collection from Bognor.', { cityPageId: 'p-chi', townLabel: 'Chichester' })
    expect(mid.decision).toMatchObject({
      status: 'from_description',
      conflict: true,
      noteCode: 'description_says_collection_from',
      listedInLabel: 'Chichester',
    })
    expect(mid.decision.display?.label).toBe('Bognor Regis')
    const edge = resolve('Collection from Bognor.', {
      cityPageId: 'p-chi',
      townLabel: 'Chichester',
      coordinates: { lat: 0, lng: -10 * KM },
    })
    expect(edge.decision.status).toBe('from_description')
    expect(edge.decision.fieldDistanceKm).toBe(25)
  })

  it('a strong place far from the field is conflicting, shown at the text place, approximate', () => {
    const { decision } = resolve('Collection from Leeds only.', {
      cityPageId: 'p-chi',
      townLabel: 'Chichester',
    })
    expect(decision).toMatchObject({
      status: 'conflicting',
      conflict: true,
      approximate: true,
      noteCode: 'listed_in',
      listedInLabel: 'Chichester',
    })
    expect(decision.display?.label).toBe('Leeds')
  })

  it('a medium cue far away is uncertain at the field, for AI', () => {
    const { decision } = resolve('Selling my PC in Leeds.', {
      cityPageId: 'p-chi',
      townLabel: 'Chichester',
    })
    expect(decision).toMatchObject({ status: 'uncertain', aiReason: 'uncertain', conflict: true })
    expect(decision.display?.label).toBe('Chichester')
  })

  it('the card pass never sends anything to AI and never marks conflicting', () => {
    const { decision } = resolve(
      'Collection from Leeds only.',
      { cityPageId: 'p-chi', townLabel: 'Chichester' },
      'card',
    )
    expect(decision).toMatchObject({ status: 'uncertain', aiReason: null })
  })

  it('a silent text is field_only; no field and no text is unknown', () => {
    expect(
      resolve('RTX 3090 for sale.', { cityPageId: 'p-chi', townLabel: 'Chichester' }).decision,
    ).toMatchObject({
      status: 'field_only',
      basis: 'field',
      confidence: 'medium',
    })
    expect(
      resolve('RTX 3090 for sale.', { cityPageId: null, townLabel: null }).decision,
    ).toMatchObject({
      status: 'unknown',
      noteCode: 'pickup_place_not_stated',
      display: null,
    })
  })

  it('a page without a point is approximate; a text place on the same page confirms it', () => {
    const only = resolve('RTX 3090.', { cityPageId: 'p-nopt', townLabel: 'Abberley' }).decision
    expect(only).toMatchObject({ status: 'field_only', approximate: true })
    const conflict = resolve('Collection from Bognor.', {
      cityPageId: 'p-nopt',
      townLabel: 'Abberley',
    }).decision
    expect(conflict).toMatchObject({
      status: 'from_description',
      conflict: true,
      approximate: true,
    })
  })

  it('a far delivery place makes the listing uncertain with a note, delivers_elsewhere for AI', () => {
    const { decision } = resolve('Can deliver to Leeds for fuel.', {
      cityPageId: 'p-chi',
      townLabel: 'Chichester',
    })
    expect(decision).toMatchObject({
      status: 'uncertain',
      noteCode: 'description_delivers_elsewhere',
      notePlaceLabel: 'Leeds',
      aiReason: 'delivers_elsewhere',
    })
    expect(decision.display?.label).toBe('Chichester')
  })

  it('two pickup places: the one at the field wins and the other is noted', () => {
    const { decision } = resolve('Collection from Chichester or Leeds.', {
      cityPageId: 'p-chi',
      townLabel: 'Chichester',
    })
    expect(decision).toMatchObject({
      status: 'confirmed',
      noteCode: 'description_names_other_pickup',
      notePlaceLabel: 'Leeds',
    })
  })

  it('a text postcode is used for agreement and shown as the nearest place, never itself', () => {
    const postcodes = new Map([['PO21 1AA', { lat: 0, lng: 15 * KM }]])
    const { decision, candidates } = resolve(
      'Collection from PO21 1AA.',
      { cityPageId: 'p-chi', townLabel: 'Chichester' },
      'detail',
      postcodes,
    )
    expect(candidates[0]?.display?.label).toBe('Bognor Regis')
    expect(decision).toMatchObject({ status: 'from_description', district: 'PO21' })
    expect(decision.display?.point).toEqual({ lat: 0, lng: 15 * KM })
  })

  it('an unknown postcode is a candidate with no point and the field stands', () => {
    const { decision, candidates } = resolve('Collection from ZZ9 9ZZ.', {
      cityPageId: 'p-chi',
      townLabel: 'Chichester',
    })
    expect(candidates[0]?.rejection).toBe('no_point')
    expect(decision.status).toBe('field_only')
  })
})

describe('handover', () => {
  it('reads the field first and lets the text add but never override', () => {
    expect(handoverFrom(['IN_PERSON'], 'No collection, postage only.')).toMatchObject({
      collection: 'yes',
      postage: 'text',
      postageOnlyText: true,
    })
    expect(handoverFrom([], 'Collection only please')).toMatchObject({
      collection: 'yes',
      postage: 'none',
    })
    expect(handoverFrom([], 'Cannot collect, can post for £5')).toMatchObject({
      collection: 'no',
      postage: 'text',
    })
    expect(handoverFrom(['SHIPPING'], 'Can deliver locally, happy to meet halfway')).toMatchObject({
      postage: 'field',
      localDelivery: 'text',
      meetupOffered: true,
    })
    expect(handoverFrom([], 'Courier delivery only')).toMatchObject({
      courierOnlyText: true,
      postage: 'text',
    })
  })
})

describe('rule version', () => {
  it('follows the thresholds', () => {
    expect(ruleVersion(T)).toMatch(/^r1\.[0-9a-f]{8}$/)
    expect(ruleVersion({ ...T, agreeKm: 11 })).not.toBe(ruleVersion(T))
  })
})
