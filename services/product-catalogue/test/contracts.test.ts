import { batchKey, createEvent, safeParseEvent } from '@nabvy/contracts'
import {
  events,
  module,
  ProductCatalogueAlias,
  ProductCatalogueItem,
  ProductCatalogueNegativeContext,
} from '@nabvy/contracts/modules/product-catalogue'
import { vAliases, vItems, vNegativeContexts } from '@nabvy/db/schema/product-catalogue'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

// ProductCatalogueItem/Alias/NegativeContext are written in Zod because contracts cannot import
// packages/db (db depends on contracts; services/audit-log/README.md, "Decisions"). These checks
// keep them derived in effect: same columns as their views.
const columnsOf = (view: object) => Object.keys(getViewConfig(view as never).selectedFields).sort()

describe('product-catalogue contracts', () => {
  it('declares its name and one event', () => {
    expect(module).toBe('product-catalogue')
    expect(Object.keys(events.definitions)).toEqual(['product-catalogue.updated'])
  })

  it('ProductCatalogueItem has exactly the columns of v_items', () => {
    expect(Object.keys(ProductCatalogueItem.shape).sort()).toEqual(columnsOf(vItems))
  })

  it('ProductCatalogueAlias has exactly the columns of v_aliases', () => {
    expect(Object.keys(ProductCatalogueAlias.shape).sort()).toEqual(columnsOf(vAliases))
  })

  it('ProductCatalogueNegativeContext has exactly the columns of v_negative_contexts', () => {
    expect(Object.keys(ProductCatalogueNegativeContext.shape).sort()).toEqual(
      columnsOf(vNegativeContexts),
    )
  })

  it('product-catalogue.updated carries catalogue IDs only and round-trips', async () => {
    const envelope = createEvent(
      events,
      'product-catalogue.updated',
      1,
      { catalogueIds: ['gpu:nvidia:rtx-5080:16gb'] },
      { key: await batchKey('product-catalogue.updated', ['gpu:nvidia:rtx-5080:16gb']) },
    )
    expect(safeParseEvent(events, envelope).success).toBe(true)
    expect(() =>
      createEvent(events, 'product-catalogue.updated', 1, { catalogueIds: [] }, { key: 'k' }),
    ).toThrow()
  })
})
