import { createEvent, safeParseEvent } from '@nabvy/contracts'
import {
  events,
  module,
  TravelCustomRate,
  TravelRate,
  TravelSettings,
  TravelUpdateSettingsInput,
} from '@nabvy/contracts/modules/travel-cost'
import { vRates } from '@nabvy/db/schema/travel-cost'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

const U1 = '00000000-0000-4000-8000-0000000000c1'

describe('travel-cost contracts', () => {
  it('declares its name and its one event', () => {
    expect(module).toBe('travel-cost')
    expect(Object.keys(events.definitions)).toEqual(['travel-settings.changed'])
  })

  it('travel-settings.changed carries only a user ID and a time, and round-trips', () => {
    const at = '2026-09-24T00:00:00.000Z'
    const envelope = createEvent(
      events,
      'travel-settings.changed',
      1,
      { userId: U1, at },
      { key: `user:${U1}@${at}` },
    )
    expect(safeParseEvent(events, envelope).success).toBe(true)
    expect(Object.keys(envelope.payload).sort()).toEqual(['at', 'userId'])
  })

  it('TravelRate has exactly the columns of v_rates', () => {
    const columns = Object.keys(getViewConfig(vRates).selectedFields)
    expect(Object.keys(TravelRate.shape).sort()).toEqual(columns.sort())
  })

  it("engineBand is a closed set: a typo can't silently match no rate row", () => {
    const rate = {
      kind: 'advisory-fuel-rate',
      fuel: 'petrol',
      tier: '',
      penceAmount: 14,
      unit: 'mile',
      effectiveFrom: '2026-03-01',
      sourceUrl: 'https://www.gov.uk/guidance/advisory-fuel-rates',
    }
    expect(TravelRate.safeParse({ ...rate, engineBand: '1401-2000' }).success).toBe(true)
    expect(TravelRate.safeParse({ ...rate, engineBand: '1401–2000' }).success).toBe(false)
    expect(
      TravelUpdateSettingsInput.safeParse({ userId: U1, engineBand: '1401 to 2000' }).success,
    ).toBe(false)
  })
})

describe('TravelSettings', () => {
  const base = {
    userId: U1,
    custom: null,
    valueOfTimePenceHour: null,
    roadFactor: null,
    speedMph: null,
    updatedAt: '2026-09-24T00:00:00.000Z',
  }

  it('refuses the fuel-only preset with no fuel', () => {
    expect(
      TravelSettings.safeParse({ ...base, preset: 'fuel-only', fuel: null, engineBand: null })
        .success,
    ).toBe(false)
  })

  it('refuses the custom preset with no custom rate', () => {
    expect(
      TravelSettings.safeParse({
        ...base,
        preset: 'custom',
        fuel: null,
        engineBand: null,
        custom: null,
      }).success,
    ).toBe(false)
  })

  it('accepts a well-formed fuel-only, HMRC business and custom settings row', () => {
    expect(
      TravelSettings.safeParse({
        ...base,
        preset: 'fuel-only',
        fuel: 'petrol',
        engineBand: '1401-2000',
      }).success,
    ).toBe(true)
    expect(
      TravelSettings.safeParse({ ...base, preset: 'hmrc-business', fuel: null, engineBand: null })
        .success,
    ).toBe(true)
    expect(
      TravelSettings.safeParse({
        ...base,
        preset: 'custom',
        fuel: null,
        engineBand: null,
        custom: { mode: 'pence-per-mile', pencePerMile: 20 },
      }).success,
    ).toBe(true)
  })

  it('£0 value of time is a valid setting, never refused', () => {
    expect(
      TravelSettings.safeParse({
        ...base,
        preset: 'fuel-only',
        fuel: 'petrol',
        engineBand: '1401-2000',
        valueOfTimePenceHour: 0,
      }).success,
    ).toBe(true)
  })
})

describe('TravelCustomRate', () => {
  it('accepts either mode', () => {
    expect(TravelCustomRate.safeParse({ mode: 'pence-per-mile', pencePerMile: 20 }).success).toBe(
      true,
    )
    expect(
      TravelCustomRate.safeParse({ mode: 'mpg', mpg: 40, fuelPricePencePerLitre: 150 }).success,
    ).toBe(true)
  })
})

describe('TravelUpdateSettingsInput', () => {
  it('refuses an update with nothing to change', () => {
    expect(TravelUpdateSettingsInput.safeParse({ userId: U1 }).success).toBe(false)
  })

  it('accepts a single-field update', () => {
    expect(
      TravelUpdateSettingsInput.safeParse({ userId: U1, valueOfTimePenceHour: 0 }).success,
    ).toBe(true)
  })
})
