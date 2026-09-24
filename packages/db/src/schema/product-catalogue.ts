import { sql } from 'drizzle-orm'
import { boolean, check, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { idColumn, moduleSchema, timestampColumns } from '../module-schema'

// Tables of the product-catalogue module, all in the Postgres schema 'product_catalogue'
// (packages/db/README.md). Only services/product-catalogue writes them. Other modules read
// through the v_ views. After changing this file: pnpm db:generate product-catalogue

export const schema = moduleSchema('product-catalogue')

// A canonical catalogue ID: colon-separated kebab-case segments (docs/packs/gpu-pc.md), e.g.
// 'gpu:nvidia:rtx-5080:16gb' or 'gpu:nvidia:rtx-5080:mobile'. Shared by every table below.

/**
 * One canonical part or product. Laptop parts get their own row (`is_mobile`), because a mobile
 * chip is a different part from its desktop namesake (docs/design/modules/product-catalogue.md).
 */
export const items = schema.table(
  'items',
  {
    catalogueId: text('catalogue_id').primaryKey(),
    kind: text('kind').notNull(),
    family: text('family'),
    variant: text('variant'),
    isMobile: boolean('is_mobile').notNull().default(false),
    packId: text('pack_id'),
    name: text('name').notNull(),
    ...timestampColumns(),
  },
  (t) => [
    check(
      'items_catalogue_id_format',
      sql`${t.catalogueId} ~ '^[a-z0-9-]+(:[a-z0-9-]+)+$' and length(${t.catalogueId}) <= 200`,
    ),
    check('items_kind', sql`${t.kind} in ('gpu', 'cpu')`),
  ],
)

/** Alternative text that resolves to a catalogue ID (README.md, "Decisions": aliases and regex
 * pattern sources share this table; a pattern row's `source` ends with `:pattern`). */
export const aliases = schema.table(
  'aliases',
  {
    id: idColumn(),
    catalogueId: text('catalogue_id')
      .notNull()
      .references(() => items.catalogueId),
    alias: text('alias').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('aliases_catalogue_id_alias_key').on(t.catalogueId, t.alias),
    check('aliases_alias_length', sql`length(${t.alias}) between 1 and 200`),
  ],
)

/**
 * A pattern that must never resolve to `blocked_catalogue_id`, e.g. "OptiPlex 3090" (a Dell
 * desktop model number) must never resolve to the RTX 3090 (docs/design/modules/
 * product-catalogue.md). Applied globally before dictionary matching (README.md, "Decisions").
 */
export const negativeContexts = schema.table(
  'negative_contexts',
  {
    id: idColumn(),
    pattern: text('pattern').notNull(),
    blockedCatalogueId: text('blocked_catalogue_id')
      .notNull()
      .references(() => items.catalogueId),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('negative_contexts_pattern_blocked_key').on(t.pattern, t.blockedCatalogueId),
    check('negative_contexts_pattern_length', sql`length(${t.pattern}) between 1 and 200`),
  ],
)

/** An EAN or CeX box ID for one catalogue item. */
export const codes = schema.table(
  'codes',
  {
    id: idColumn(),
    catalogueId: text('catalogue_id')
      .notNull()
      .references(() => items.catalogueId),
    kind: text('kind').notNull(),
    code: text('code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('codes_kind_code_key').on(t.kind, t.code),
    check('codes_kind', sql`${t.kind} in ('ean', 'cex_box')`),
  ],
)

const itemColumns = {
  catalogueId: text('catalogue_id').notNull(),
  kind: text('kind').notNull(),
  family: text('family'),
  variant: text('variant'),
  isMobile: boolean('is_mobile').notNull(),
  packId: text('pack_id'),
  name: text('name').notNull(),
}

/** Every catalogue item, for internal readers (README.md). Empty while the module is off. */
export const vItems = schema.view('v_items', itemColumns).existing()

/** Every alias (and pattern-source row; README.md, "Decisions"), for internal readers. */
export const vAliases = schema
  .view('v_aliases', {
    id: uuid('id').notNull(),
    catalogueId: text('catalogue_id').notNull(),
    alias: text('alias').notNull(),
    source: text('source').notNull(),
  })
  .existing()

/** Every negative context, for internal readers. */
export const vNegativeContexts = schema
  .view('v_negative_contexts', {
    id: uuid('id').notNull(),
    pattern: text('pattern').notNull(),
    blockedCatalogueId: text('blocked_catalogue_id').notNull(),
    source: text('source').notNull(),
  })
  .existing()
