import { batchKey, createEvent, safeParseEvent } from '@nabvy/contracts'
import {
  CityPagesAreaMembership,
  CityPagesCentre,
  CityPagesCityPage,
  events,
  module,
} from '@nabvy/contracts/modules/city-pages'
import { vAreaMembership, vCentres, vCityPages } from '@nabvy/db/schema/city-pages'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

// Zod schemas written by hand (drizzle-zod is not a dependency yet, as listing-ingest's README
// notes): these checks keep each one's keys in step with its view's columns.
const keysOf = (shape: z.ZodRawShape) => Object.keys(shape).sort()

describe('city-pages contracts', () => {
  it('declares its name and one event', () => {
    expect(module).toBe('city-pages')
    expect(Object.keys(events.definitions)).toEqual(['city-pages.changed'])
  })

  it('CityPagesCityPage has exactly the columns of v_city_pages', () => {
    const columns = Object.keys(getViewConfig(vCityPages).selectedFields).sort()
    expect(keysOf(CityPagesCityPage.def.shape)).toEqual(columns)
  })

  it('CityPagesCentre has exactly the columns of v_centres', () => {
    const columns = Object.keys(getViewConfig(vCentres).selectedFields).sort()
    expect(keysOf(CityPagesCentre.def.shape)).toEqual(columns)
  })

  it('CityPagesAreaMembership has exactly the columns of v_area_membership', () => {
    const columns = Object.keys(getViewConfig(vAreaMembership).selectedFields).sort()
    expect(keysOf(CityPagesAreaMembership.def.shape)).toEqual(columns)
  })

  it('city-pages.changed carries city page IDs only and round-trips', async () => {
    const envelope = createEvent(
      events,
      'city-pages.changed',
      1,
      { cityPageIds: ['115935195086622'] },
      { key: await batchKey('city-pages.changed', ['115935195086622']) },
    )
    expect(safeParseEvent(events, envelope).success).toBe(true)
    expect(() =>
      createEvent(events, 'city-pages.changed', 1, { cityPageIds: [] }, { key: 'k' }),
    ).toThrow()
  })
})
