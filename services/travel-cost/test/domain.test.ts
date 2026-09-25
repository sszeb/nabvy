import type { TravelRate } from '@nabvy/contracts/modules/travel-cost'
import { describe, expect, it } from 'vitest'
import {
  assertUsableSettings,
  calculateTripCost,
  DEFAULT_SETTINGS as DOMAIN_DEFAULTS,
  formatPence,
  pencePerMileFromCustom,
  resolveMileRate,
  resolveParams,
  resolveRate,
  resolveValueOfTime,
  TravelCostRefused,
} from '../src/domain'

// The seeded rows (packages/db/migrations/travel-cost/20260924172748_travel_cost_seed.sql),
// reproduced here so this suite runs with no database.
const RATES: TravelRate[] = [
  {
    kind: 'advisory-fuel-rate',
    fuel: 'petrol',
    engineBand: '1401-2000',
    tier: '',
    penceAmount: 14,
    unit: 'mile',
    effectiveFrom: '2026-03-01',
    sourceUrl: 'https://www.gov.uk/guidance/advisory-fuel-rates',
  },
  {
    kind: 'approved-mileage-rate',
    fuel: '',
    engineBand: '',
    tier: 'standard',
    penceAmount: 55,
    unit: 'mile',
    effectiveFrom: '2026-04-06',
    sourceUrl:
      'https://www.gov.uk/government/publications/increase-to-approved-mileage-allowance-payments-amaps-and-self-employed-simplified-mileage-rates/increasing-mileage-rates',
  },
  {
    kind: 'approved-mileage-rate',
    fuel: '',
    engineBand: '',
    tier: 'reduced',
    penceAmount: 25,
    unit: 'mile',
    effectiveFrom: '2026-04-06',
    sourceUrl:
      'https://www.gov.uk/government/publications/increase-to-approved-mileage-allowance-payments-amaps-and-self-employed-simplified-mileage-rates/increasing-mileage-rates',
  },
  {
    kind: 'value-of-time',
    fuel: '',
    engineBand: '',
    tier: '',
    penceAmount: 1271,
    unit: 'hour',
    effectiveFrom: '2026-04-01',
    sourceUrl: 'https://www.gov.uk/national-minimum-wage-rates',
  },
]

const ASOF = new Date('2026-09-24T00:00:00.000Z')
const DEFAULT_SETTINGS = {
  preset: 'fuel-only' as const,
  fuel: 'petrol',
  engineBand: '1401-2000',
  custom: null,
  valueOfTimePenceHour: null,
  roadFactor: null,
  speedMph: null,
}

// The extra-distance round trip a straight-line "extra mile" becomes, at the config defaults
// (c = 1.3, v = 35 mph): docs/design/drafts/search-map-routes.md §4.2.
function extraMileLeg(straightLineMiles: number) {
  const roadMiles = 2 * 1.3 * straightLineMiles
  const minutes = (roadMiles / 35) * 60
  return { roadMiles, minutes }
}

describe('resolveRate', () => {
  it('picks the latest row on or before the given date', () => {
    const afr = RATES.find((rate) => rate.kind === 'advisory-fuel-rate')
    if (!afr) throw new Error('fixture RATES is missing its advisory-fuel-rate row')
    const rates: TravelRate[] = [
      { ...afr, penceAmount: 13, effectiveFrom: '2025-12-01' },
      { ...afr, penceAmount: 14, effectiveFrom: '2026-03-01' },
    ]
    expect(
      resolveRate(
        rates,
        { kind: 'advisory-fuel-rate', fuel: 'petrol', engineBand: '1401-2000' },
        new Date('2026-02-01'),
      ),
    ).toMatchObject({ penceAmount: 13 })
    expect(
      resolveRate(
        rates,
        { kind: 'advisory-fuel-rate', fuel: 'petrol', engineBand: '1401-2000' },
        new Date('2026-06-01'),
      ),
    ).toMatchObject({ penceAmount: 14 })
  })

  it('is undefined before any row applies', () => {
    expect(
      resolveRate(
        RATES,
        { kind: 'advisory-fuel-rate', fuel: 'diesel', engineBand: '1401-2000' },
        ASOF,
      ),
    ).toBeUndefined()
  })
})

describe('resolveMileRate', () => {
  it('resolves the fuel-only preset to the advisory fuel rate', () => {
    expect(resolveMileRate(DEFAULT_SETTINGS, RATES, ASOF).pence).toBe(14)
  })

  it('resolves the HMRC business preset to the standard approved-mileage rate', () => {
    expect(
      resolveMileRate({ ...DEFAULT_SETTINGS, preset: 'hmrc-business' }, RATES, ASOF).pence,
    ).toBe(55)
  })

  it('resolves a custom pence-per-mile rate without touching the rate table', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      preset: 'custom' as const,
      custom: { mode: 'pence-per-mile' as const, pencePerMile: 20 },
    }
    expect(resolveMileRate(settings, [], ASOF).pence).toBe(20)
  })

  it('refuses a preset with no rate for the date', () => {
    expect(() => resolveMileRate(DEFAULT_SETTINGS, RATES, new Date('2020-01-01'))).toThrow(
      TravelCostRefused,
    )
  })
})

describe('pencePerMileFromCustom', () => {
  it('converts mpg and a fuel price to pence per mile', () => {
    // 40 mpg at 150p/litre: 150 * 4.54609 / 40 = 17.0478...p/mile
    expect(
      pencePerMileFromCustom({ mode: 'mpg', mpg: 40, fuelPricePencePerLitre: 150 }),
    ).toBeCloseTo(17.0478, 3)
  })
})

describe('resolveValueOfTime', () => {
  it('defaults to the National Living Wage rate row', () => {
    expect(resolveValueOfTime({ valueOfTimePenceHour: null }, RATES, ASOF)?.pence).toBe(1271)
  })

  it('£0 means "don\'t count my time" — no time cost, not a rate lookup', () => {
    expect(resolveValueOfTime({ valueOfTimePenceHour: 0 }, RATES, ASOF)).toBeNull()
  })

  it('a user override is used as given, never checked against a rate row', () => {
    expect(resolveValueOfTime({ valueOfTimePenceHour: 500 }, [], ASOF)?.pence).toBe(500)
  })

  it('includeTime: false skips it regardless of the setting', () => {
    expect(
      resolveValueOfTime({ valueOfTimePenceHour: 500 }, RATES, ASOF, { includeTime: false }),
    ).toBeNull()
  })
})

describe("calculateTripCost: the card's worked numbers", () => {
  it('per extra straight-line mile: £1.31 (fuel-only + time, the default)', () => {
    const mile = resolveMileRate(DEFAULT_SETTINGS, RATES, ASOF)
    const time = resolveValueOfTime(DEFAULT_SETTINGS, RATES, ASOF)
    const result = calculateTripCost([extraMileLeg(1)], mile, time)
    expect(result.amountMinor).toBe(131)
  })

  it('5 extra miles: £6.54 total, £1.82 fuel only, £11.87 at the HMRC business rate plus time', () => {
    const leg = extraMileLeg(5)
    const mile = resolveMileRate(DEFAULT_SETTINGS, RATES, ASOF)
    const time = resolveValueOfTime(DEFAULT_SETTINGS, RATES, ASOF)
    expect(calculateTripCost([leg], mile, time).amountMinor).toBe(654)
    expect(calculateTripCost([leg], mile, null).amountMinor).toBe(182)

    const businessMile = resolveMileRate(
      { ...DEFAULT_SETTINGS, preset: 'hmrc-business' },
      RATES,
      ASOF,
    )
    expect(calculateTripCost([leg], businessMile, time).amountMinor).toBe(1187)
  })

  it('10 extra miles: £13.08', () => {
    const mile = resolveMileRate(DEFAULT_SETTINGS, RATES, ASOF)
    const time = resolveValueOfTime(DEFAULT_SETTINGS, RATES, ASOF)
    expect(calculateTripCost([extraMileLeg(10)], mile, time).amountMinor).toBe(1308)
  })

  it('sums several legs before rounding once', () => {
    const mile = resolveMileRate(DEFAULT_SETTINGS, RATES, ASOF)
    const time = resolveValueOfTime(DEFAULT_SETTINGS, RATES, ASOF)
    const combined = calculateTripCost([extraMileLeg(1), extraMileLeg(4)], mile, time)
    expect(combined.amountMinor).toBe(calculateTripCost([extraMileLeg(5)], mile, time).amountMinor)
  })

  it('the basis sentence names the rate and, with time, both parts', () => {
    const mile = resolveMileRate(DEFAULT_SETTINGS, RATES, ASOF)
    const time = resolveValueOfTime(DEFAULT_SETTINGS, RATES, ASOF)
    const { basis } = calculateTripCost([extraMileLeg(1)], mile, time)
    expect(basis).toContain('14p a mile')
    expect(basis).toContain('advisory fuel rate')
    expect(basis).toContain('1 Mar 2026')
    expect(basis).toContain('£12.71 an hour')
    expect(basis).toContain('National Living Wage')
  })
})

describe('resolveParams', () => {
  it('rounds pence-per-mile and pence-per-hour, and fills config defaults', () => {
    const result = resolveParams(DEFAULT_SETTINGS, RATES, ASOF, { roadFactor: 1.3, speedMph: 35 })
    expect(result).toEqual({ pencePerMile: 14, penceHour: 1271, roadFactor: 1.3, speedMph: 35 })
  })

  it('penceHour is null when the user set £0', () => {
    const result = resolveParams({ ...DEFAULT_SETTINGS, valueOfTimePenceHour: 0 }, RATES, ASOF, {
      roadFactor: 1.3,
      speedMph: 35,
    })
    expect(result.penceHour).toBeNull()
  })

  it('a user override replaces the config default', () => {
    const result = resolveParams(
      { ...DEFAULT_SETTINGS, roadFactor: 1.5, speedMph: 30 },
      RATES,
      ASOF,
      { roadFactor: 1.3, speedMph: 35 },
    )
    expect(result.roadFactor).toBe(1.5)
    expect(result.speedMph).toBe(30)
  })

  it('refuses a custom rate that rounds to 0p a mile rather than hand TravelParams a 0', () => {
    // 1p a litre at 1,000 mpg: 1 × 4.54609 ÷ 1000 = 0.0045p a mile.
    const settings = {
      ...DEFAULT_SETTINGS,
      preset: 'custom' as const,
      custom: { mode: 'mpg' as const, mpg: 1000, fuelPricePencePerLitre: 1 },
    }
    expect(() => resolveParams(settings, RATES, ASOF, { roadFactor: 1.3, speedMph: 35 })).toThrow(
      expect.objectContaining({ code: 'travel-cost.invalid_input' }),
    )
  })
})

describe('assertUsableSettings', () => {
  const U1 = '00000000-0000-4000-8000-0000000000c1'
  const base = { userId: U1, ...DOMAIN_DEFAULTS, updatedAt: '2026-09-24T00:00:00.000Z' }

  it('the defaults are a usable row (the shape the repo and the "no row yet" read share)', () => {
    expect(() => assertUsableSettings(base)).not.toThrow()
  })

  it('refuses the custom preset with no custom rate saved', () => {
    expect(() => assertUsableSettings({ ...base, preset: 'custom' })).toThrow(
      expect.objectContaining({ code: 'travel-cost.invalid_input' }),
    )
  })

  it('refuses the fuel-only preset with its fuel cleared', () => {
    expect(() => assertUsableSettings({ ...base, fuel: null })).toThrow(
      expect.objectContaining({ code: 'travel-cost.invalid_input' }),
    )
  })

  it('refuses a custom mpg rate that rounds to 0p a mile', () => {
    expect(() =>
      assertUsableSettings({
        ...base,
        preset: 'custom',
        custom: { mode: 'mpg', mpg: 1000, fuelPricePencePerLitre: 1 },
      }),
    ).toThrow(expect.objectContaining({ code: 'travel-cost.invalid_input' }))
  })
})

describe('formatPence', () => {
  it('shows pence under £1 and pounds from £1', () => {
    expect(formatPence(36)).toBe('36p')
    expect(formatPence(131)).toBe('£1.31')
    expect(formatPence(1271)).toBe('£12.71')
  })
})
