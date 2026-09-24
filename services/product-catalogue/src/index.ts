// Public API of the product-catalogue module: the functions other modules and admin procedures
// may call. Other modules import from '@nabvy/product-catalogue' only, never from its internals.
import { record } from '@nabvy/audit-log'
import { PRODUCT_CATALOGUE_FUZZY_MATCH_THRESHOLD } from '@nabvy/config/modules/product-catalogue'
import { createEvent, type EventEnvelope } from '@nabvy/contracts'
import {
  events,
  module,
  type ProductCatalogueAddAliasInput,
  type ProductCatalogueAddCodeInput,
  type ProductCatalogueAddItemInput,
  type ProductCatalogueAddNegativeContextInput,
  type ProductCatalogueId,
  type ProductCatalogueMatch,
} from '@nabvy/contracts/modules/product-catalogue'
import type { Queryable } from '@nabvy/db'
import { state as switchState } from '@nabvy/switches'
import {
  planAddAlias,
  planAddCode,
  planAddItem,
  planAddNegativeContext,
  sameItem,
} from './domain/edits'
import { ProductCatalogueRefused } from './domain/errors'
import { updatedKey } from './domain/keys'
import { resolveDictionary } from './domain/resolve'
import {
  ForeignKeyViolation,
  insertAlias,
  insertCode,
  insertNegativeContext,
  selectAllForResolve,
  selectFuzzyMatch,
  selectItem,
  selectItemByCode,
  upsertItem,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/product-catalogue'
export { ProductCatalogueRefused } from './domain/errors'

function updatedEvent(catalogueIds: ProductCatalogueId[], at: Date): EventEnvelope {
  return createEvent(
    events,
    'product-catalogue.updated',
    1,
    { catalogueIds },
    { key: updatedKey(catalogueIds, at) },
  ) as EventEnvelope
}

/**
 * Resolves text to a catalogue ID: the dictionary tier (aliases and patterns) first, then pg_trgm
 * similarity over item names (docs/design/modules/product-catalogue.md). Empty while the module is
 * off (rule 11 of docs/design/modules/_rules.md): callers then treat the part as not stated, the
 * same as an empty match.
 */
export async function resolve(q: Queryable, text: string): Promise<ProductCatalogueMatch[]> {
  if ((await switchState(q, module)) === 'off') return []
  const data = await selectAllForResolve(q)
  const dictionaryMatches = resolveDictionary(text, data.items, data.aliases, data.negativeContexts)
  if (dictionaryMatches.length > 0) return dictionaryMatches
  const fuzzy = await selectFuzzyMatch(q, text, PRODUCT_CATALOGUE_FUZZY_MATCH_THRESHOLD)
  if (!fuzzy) return []
  return [
    {
      family: fuzzy.family,
      catalogueId: fuzzy.catalogueId,
      candidates: [fuzzy.catalogueId],
      text,
      index: 0,
    },
  ]
}

/** The catalogue item one EAN or CeX box ID names, if any. */
export function lookupByCode(
  q: Queryable,
  kind: 'ean' | 'cex_box',
  code: string,
): Promise<ProductCatalogueId | undefined> {
  return selectItemByCode(q, kind, code)
}

/**
 * Adds or updates one canonical item. The caller has already checked that the session is an
 * admin's, and passes the transaction (`withPipeline`) so the write and its audit row commit
 * together. Writing the same values again changes nothing and is not re-audited. Throws
 * `ProductCatalogueRefused` for bad input.
 */
export async function addItem(
  q: Queryable,
  input: ProductCatalogueAddItemInput,
): Promise<{ changed: boolean; event?: EventEnvelope }> {
  const parsed = planAddItem(input)
  const current = await selectItem(q, parsed.catalogueId)
  if (current && sameItem(current, parsed)) return { changed: false }
  const updatedAt = await upsertItem(q, parsed)
  await record(q, {
    actorUserId: parsed.actorUserId,
    action: 'product-catalogue.item-added',
    target: `item:${parsed.catalogueId}`,
    ...(current ? { before: current } : {}),
    after: {
      kind: parsed.kind,
      family: parsed.family,
      variant: parsed.variant,
      isMobile: parsed.isMobile,
      packId: parsed.packId,
      name: parsed.name,
    },
  })
  return { changed: true, event: updatedEvent([parsed.catalogueId], updatedAt) }
}

/**
 * Adds one alias to an item. A repeat of the same catalogue ID and alias text writes nothing.
 * Throws `ProductCatalogueRefused` for bad input or a catalogue ID that does not exist.
 */
export async function addAlias(
  q: Queryable,
  input: ProductCatalogueAddAliasInput,
): Promise<{ changed: boolean; event?: EventEnvelope }> {
  const parsed = planAddAlias(input)
  const inserted = await insertAlias(q, parsed).catch(rethrowUnknownItem)
  if (!inserted) return { changed: false }
  await record(q, {
    actorUserId: parsed.actorUserId,
    action: 'product-catalogue.alias-added',
    target: `item:${parsed.catalogueId}`,
    after: { alias: parsed.alias, source: parsed.source },
  })
  return { changed: true, event: updatedEvent([parsed.catalogueId], inserted.createdAt) }
}

/**
 * Adds one negative context: `pattern` will never resolve to `blockedCatalogueId` (docs/design/
 * modules/product-catalogue.md). A repeat of the same pattern and blocked ID writes nothing.
 */
export async function addNegativeContext(
  q: Queryable,
  input: ProductCatalogueAddNegativeContextInput,
): Promise<{ changed: boolean; event?: EventEnvelope }> {
  const parsed = planAddNegativeContext(input)
  const inserted = await insertNegativeContext(q, parsed).catch(rethrowUnknownItem)
  if (!inserted) return { changed: false }
  await record(q, {
    actorUserId: parsed.actorUserId,
    action: 'product-catalogue.negative-context-added',
    target: `item:${parsed.blockedCatalogueId}`,
    after: { pattern: parsed.pattern, source: parsed.source },
  })
  return { changed: true, event: updatedEvent([parsed.blockedCatalogueId], inserted.createdAt) }
}

/** Adds one EAN or CeX box ID to an item. A repeat of the same kind and code writes nothing. */
export async function addCode(
  q: Queryable,
  input: ProductCatalogueAddCodeInput,
): Promise<{ changed: boolean; event?: EventEnvelope }> {
  const parsed = planAddCode(input)
  const inserted = await insertCode(q, parsed).catch(rethrowUnknownItem)
  if (!inserted) return { changed: false }
  await record(q, {
    actorUserId: parsed.actorUserId,
    action: 'product-catalogue.code-added',
    target: `item:${parsed.catalogueId}`,
    after: { kind: parsed.kind, code: parsed.code },
  })
  return { changed: true, event: updatedEvent([parsed.catalogueId], inserted.createdAt) }
}

function rethrowUnknownItem(cause: unknown): never {
  if (cause instanceof ForeignKeyViolation) {
    throw new ProductCatalogueRefused('product-catalogue.unknown_item', cause.message)
  }
  throw cause
}
