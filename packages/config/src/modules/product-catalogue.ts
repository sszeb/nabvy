import { z } from 'zod'

// Thresholds of the product-catalogue module (rule 14 of docs/design/modules/_rules.md).

const productCatalogueConfig = z.object({
  fuzzyMatchThreshold: z.number().min(0).max(1),
  mobileIndicatorPattern: z.string().min(1),
})

const config = productCatalogueConfig.parse({
  /**
   * `resolve()`'s second tier: pg_trgm `similarity()` against item names, used only when the
   * dictionary tier (aliases and patterns) finds nothing (docs/design/modules/product-catalogue.md,
   * "resolve(text) tries the dictionary, then pg_trgm similarity"). Basis: no fixtures yet exercise
   * this tier (PGlite, used by this module's own tests, has no pg_trgm; only `pnpm db:dry-run`'s
   * `packages/db/tests/product-catalogue.test.sql` runs on real Postgres). Status: starting value,
   * to be calibrated once fixtures cover it.
   */
  fuzzyMatchThreshold: 0.4,
  /**
   * Marks a text as describing a laptop or mobile part, so `resolve()` looks among mobile items
   * for a GPU family before desktop ones (desktop and mobile chips differ, docs/design/modules/
   * product-catalogue.md). A narrowed version of the actor's `laptopTitle` pattern (`fb-scrap-
   * engine/docs/data/part-patterns.json`, copied at `packages/packs/gpu-pc/data/part-patterns.json`):
   * the generic words only, not every laptop model name, because this module has no fixtures yet to
   * measure the fuller pattern's precision here. Status: starting value.
   */
  mobileIndicatorPattern: '\\b(laptop|notebook|macbook|chromebook|mobile)\\b',
})

export const PRODUCT_CATALOGUE_FUZZY_MATCH_THRESHOLD = config.fuzzyMatchThreshold
export const PRODUCT_CATALOGUE_MOBILE_INDICATOR_PATTERN = config.mobileIndicatorPattern
