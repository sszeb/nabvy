// Database access to the product-catalogue schema only. Reads for resolve() go straight to this
// module's own tables (not through its v_ views, which other modules read); the fuzzy tier uses
// pg_trgm, only reachable on real Postgres (packages/db/tests/product-catalogue.test.sql), never
// in this module's own tests, which run on PGlite (services/product-catalogue/test/support).
import type {
  ProductCatalogueAddAliasInput,
  ProductCatalogueAddCodeInput,
  ProductCatalogueAddItemInput,
  ProductCatalogueAddNegativeContextInput,
  ProductCatalogueId,
} from '@nabvy/contracts/modules/product-catalogue'
import type { Queryable } from '@nabvy/db'
import { aliases, codes, items, negativeContexts } from '@nabvy/db/schema/product-catalogue'
import { sql } from 'drizzle-orm'
import type { CatalogueAliasRow, CatalogueItemRow, NegativeContextRow } from '../domain/resolve'

export interface CatalogueData {
  items: CatalogueItemRow[]
  aliases: CatalogueAliasRow[]
  negativeContexts: NegativeContextRow[]
}

/** Everything `resolveDictionary()` needs, freshly read for every call (no caching yet). */
export async function selectAllForResolve(q: Queryable): Promise<CatalogueData> {
  const [itemRows, aliasRows, negativeContextRows] = await Promise.all([
    q
      .select({
        catalogueId: items.catalogueId,
        kind: items.kind,
        family: items.family,
        name: items.name,
        variant: items.variant,
        isMobile: items.isMobile,
      })
      .from(items),
    q
      .select({ catalogueId: aliases.catalogueId, alias: aliases.alias, source: aliases.source })
      .from(aliases),
    q.select({ pattern: negativeContexts.pattern }).from(negativeContexts),
  ])
  return {
    items: itemRows as CatalogueItemRow[],
    aliases: aliasRows,
    negativeContexts: negativeContextRows,
  }
}

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

/**
 * The pg_trgm tier: the item whose name is most similar to `text`, if at or above `threshold`.
 * `extensions.similarity` is used qualified so this does not depend on the caller's search path.
 */
export async function selectFuzzyMatch(
  q: Queryable,
  text: string,
  threshold: number,
): Promise<{ catalogueId: ProductCatalogueId; family: string } | undefined> {
  const result = await q.execute(sql`
    select catalogue_id, coalesce(family, catalogue_id) as family
    from product_catalogue.items
    where extensions.similarity(name, ${text}) >= ${threshold}
    order by extensions.similarity(name, ${text}) desc
    limit 1
  `)
  const [row] = rowsOf<{ catalogue_id: string; family: string }>(result)
  return row
    ? { catalogueId: row.catalogue_id as ProductCatalogueId, family: row.family }
    : undefined
}

export class ForeignKeyViolation extends Error {}

// Drizzle wraps the driver's error in `DrizzleQueryError`, whose `.cause` carries the underlying
// Postgres error (with `.code`); pg and PGlite both surface it this way.
const isForeignKeyViolation = (error: unknown): boolean => {
  if (error === null || typeof error !== 'object') return false
  if ((error as { code?: string }).code === '23503') return true
  return isForeignKeyViolation((error as { cause?: unknown }).cause)
}

async function insertOrRefuse<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (cause) {
    if (isForeignKeyViolation(cause)) {
      throw new ForeignKeyViolation('references a catalogue ID that does not exist', { cause })
    }
    throw cause
  }
}

/** The current stored value of an item, for `addItem` to compare before writing (domain/edits.ts). */
export async function selectItem(
  q: Queryable,
  catalogueId: string,
): Promise<
  | {
      kind: string
      family: string | null
      variant: string | null
      isMobile: boolean
      packId: string | null
      name: string
    }
  | undefined
> {
  const [row] = await q
    .select({
      kind: items.kind,
      family: items.family,
      variant: items.variant,
      isMobile: items.isMobile,
      packId: items.packId,
      name: items.name,
    })
    .from(items)
    .where(sql`${items.catalogueId} = ${catalogueId}`)
  return row
}

/** Writes the item and returns its new `updated_at`, for the `product-catalogue.updated` key. */
export async function upsertItem(q: Queryable, input: ProductCatalogueAddItemInput): Promise<Date> {
  const [row] = await q
    .insert(items)
    .values({
      catalogueId: input.catalogueId,
      kind: input.kind,
      family: input.family,
      variant: input.variant,
      isMobile: input.isMobile,
      packId: input.packId,
      name: input.name,
    })
    .onConflictDoUpdate({
      target: items.catalogueId,
      set: {
        kind: input.kind,
        family: input.family,
        variant: input.variant,
        isMobile: input.isMobile,
        packId: input.packId,
        name: input.name,
        updatedAt: sql`now()`,
      },
    })
    .returning({ updatedAt: items.updatedAt })
  if (!row) throw new Error(`item ${input.catalogueId} was not written`)
  return row.updatedAt
}

/** Inserts the alias, or returns undefined when it already exists (a true no-op: nothing to audit
 * or publish). */
export async function insertAlias(
  q: Queryable,
  input: ProductCatalogueAddAliasInput,
): Promise<{ createdAt: Date } | undefined> {
  const [row] = await insertOrRefuse(() =>
    q
      .insert(aliases)
      .values({ catalogueId: input.catalogueId, alias: input.alias, source: input.source })
      .onConflictDoNothing({ target: [aliases.catalogueId, aliases.alias] })
      .returning({ createdAt: aliases.createdAt }),
  )
  return row
}

export async function insertNegativeContext(
  q: Queryable,
  input: ProductCatalogueAddNegativeContextInput,
): Promise<{ createdAt: Date } | undefined> {
  const [row] = await insertOrRefuse(() =>
    q
      .insert(negativeContexts)
      .values({
        pattern: input.pattern,
        blockedCatalogueId: input.blockedCatalogueId,
        source: input.source,
      })
      .onConflictDoNothing({
        target: [negativeContexts.pattern, negativeContexts.blockedCatalogueId],
      })
      .returning({ createdAt: negativeContexts.createdAt }),
  )
  return row
}

export async function insertCode(
  q: Queryable,
  input: ProductCatalogueAddCodeInput,
): Promise<{ createdAt: Date } | undefined> {
  const [row] = await insertOrRefuse(() =>
    q
      .insert(codes)
      .values({ catalogueId: input.catalogueId, kind: input.kind, code: input.code })
      .onConflictDoNothing({ target: [codes.kind, codes.code] })
      .returning({ createdAt: codes.createdAt }),
  )
  return row
}

/** The catalogue item one EAN or CeX box ID names, if any. */
export async function selectItemByCode(
  q: Queryable,
  kind: 'ean' | 'cex_box',
  code: string,
): Promise<ProductCatalogueId | undefined> {
  const [row] = await q
    .select({ catalogueId: codes.catalogueId })
    .from(codes)
    .where(sql`${codes.kind} = ${kind} and ${codes.code} = ${code}`)
  return row?.catalogueId as ProductCatalogueId | undefined
}
