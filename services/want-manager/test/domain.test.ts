import { WANT_MANAGER_FREE_ACTIVE_WANT_LIMIT } from '@nabvy/config/modules/want-manager'
import { describe, expect, it } from 'vitest'
import {
  activeWantCap,
  changedKey,
  deletedKey,
  type WantContent,
  wantVersionHash,
} from '../src/domain'

const content: WantContent = {
  lat: 50.8367,
  lng: -0.7792,
  radiusKm: 25,
  centreId: 'chichester',
  centreVerified: false,
  priceCapMinor: 250000,
  currency: 'GBP',
  active: true,
  cadenceSeconds: 300,
  deliverySpeed: 'instant',
  deliveryMethods: ['posted', 'collection'],
  alternatives: 'variants_plus_tier',
  pcContainment: false,
  alternativesMaxPriceMinor: null,
  instantAlternatives: false,
  instantTopPicks: true,
  filter: { query: 'rtx', priceMaxMinor: 200000 },
  criteria: [
    { partType: 'gpu', catalogueId: 'gpu:rtx-4080', family: null, minAttr: null, orBetter: true },
  ],
}

describe('wantVersionHash', () => {
  it('is a sha256 hex, the same for the same content in any key or method order', () => {
    const hash = wantVersionHash(content)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    const reordered: WantContent = {
      ...content,
      deliveryMethods: ['collection', 'posted'],
      filter: { priceMaxMinor: 200000, query: 'rtx' },
      criteria: [
        {
          orBetter: true,
          minAttr: null,
          family: null,
          catalogueId: 'gpu:rtx-4080',
          partType: 'gpu',
        },
      ],
    }
    expect(wantVersionHash(reordered)).toBe(hash)
    expect(wantVersionHash({ ...content, radiusKm: 26 })).not.toBe(hash)
    expect(wantVersionHash({ ...content, centreId: 'redhill' })).not.toBe(hash)
    expect(wantVersionHash({ ...content, active: false })).not.toBe(hash)
  })
})

describe('event keys', () => {
  it('carry the want ID and its version, or the literal deleted', () => {
    const hash = wantVersionHash(content)
    expect(changedKey('w1', hash)).toBe(`want-manager.changed:w1@${hash.slice(0, 16)}`)
    expect(deletedKey('w1')).toBe('want-manager.changed:w1@deleted')
  })
})

describe('activeWantCap', () => {
  it('uses the Free limit while subscriptions is off, whatever the entitlement says', () => {
    expect(
      activeWantCap({
        subscriptionsState: 'off',
        entitlementWants: 10,
        fairUseMaxActiveHunts: null,
      }),
    ).toBe(WANT_MANAGER_FREE_ACTIVE_WANT_LIMIT)
    expect(WANT_MANAGER_FREE_ACTIVE_WANT_LIMIT).toBe(3)
  })
  it("uses the tier's count while on or in shadow, and the Free limit when none is known", () => {
    expect(
      activeWantCap({
        subscriptionsState: 'on',
        entitlementWants: 10,
        fairUseMaxActiveHunts: null,
      }),
    ).toBe(10)
    expect(
      activeWantCap({
        subscriptionsState: 'shadow',
        entitlementWants: 0,
        fairUseMaxActiveHunts: null,
      }),
    ).toBe(0)
    expect(
      activeWantCap({
        subscriptionsState: 'on',
        entitlementWants: null,
        fairUseMaxActiveHunts: null,
      }),
    ).toBe(3)
  })
  it('a fair-use limit only ever lowers the cap', () => {
    expect(
      activeWantCap({ subscriptionsState: 'on', entitlementWants: 10, fairUseMaxActiveHunts: 2 }),
    ).toBe(2)
    expect(
      activeWantCap({ subscriptionsState: 'on', entitlementWants: 1, fairUseMaxActiveHunts: 2 }),
    ).toBe(1)
    expect(
      activeWantCap({
        subscriptionsState: 'off',
        entitlementWants: null,
        fairUseMaxActiveHunts: 0,
      }),
    ).toBe(0)
    expect(
      activeWantCap({ subscriptionsState: 'on', entitlementWants: 3, fairUseMaxActiveHunts: 3 }),
    ).toBe(3)
  })
})
