// Regenerates 20260924151942_product_catalogue_seed.sql from the gpu-pc pack (packages/packs/
// gpu-pc/data). Run again whenever that pack's dictionary.json or part-patterns.json changes,
// review the diff, and commit the regenerated file as a new migration (forward-only:
// packages/db/README.md, "Migrations" -- never edit a merged file). This script is a dev tool; it
// reads the pack's JSON data files directly rather than importing @nabvy/product-catalogue or
// @nabvy/packs, so it has no runtime dependency on either package.
//
// Usage: node packages/db/migrations/product-catalogue/generate-seed.mjs > <new-migration>.sql
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const dictionary = JSON.parse(
  readFileSync(`${root}/packages/packs/gpu-pc/data/dictionary.json`, 'utf8'),
)
const partPatterns = JSON.parse(
  readFileSync(`${root}/packages/packs/gpu-pc/data/part-patterns.json`, 'utf8'),
)

const esc = (value) => value.replaceAll("'", "''")
const sqlValue = (value) => (value === null ? 'null' : `'${esc(String(value))}'`)

const items = []
const aliasRows = []
const codeRows = []

for (const entry of dictionary) {
  const kind = entry.productKey.split(':')[0]
  items.push({
    catalogueId: entry.productKey,
    kind,
    family: entry.family ?? null,
    variant: entry.vramGb ? `${entry.vramGb}gb` : null,
    isMobile: false,
    packId: 'gpu-pc',
    name: entry.name,
  })
  for (const alias of entry.aliases ?? []) {
    aliasRows.push({ catalogueId: entry.productKey, alias, source: 'pack:gpu-pc' })
  }
  for (const pattern of entry.patterns ?? []) {
    aliasRows.push({ catalogueId: entry.productKey, alias: pattern, source: 'pack:gpu-pc:pattern' })
  }
  for (const ean of entry.eans ?? [])
    codeRows.push({ catalogueId: entry.productKey, kind: 'ean', code: ean })
  for (const cexBoxId of entry.cexBoxIds ?? []) {
    codeRows.push({ catalogueId: entry.productKey, kind: 'cex_box', code: cexBoxId })
  }
}

// The pack has no laptop GPU data, so a mobile item's own VRAM is not stated (never a guess,
// docs/packs/gpu-pc.md); its aliases are the desktop family's own (they never compete: this
// module's resolve() only ever searches mobile or desktop items, never both at once).
const aliasesByFamily = new Map()
for (const entry of dictionary) {
  const family = entry.family ?? entry.productKey
  const set = aliasesByFamily.get(family) ?? new Set()
  for (const alias of entry.aliases ?? []) set.add(alias)
  aliasesByFamily.set(family, set)
}

const vendorOf = (model) => {
  if (model.startsWith('RTX') || model.startsWith('GTX')) return 'nvidia'
  if (model.startsWith('RX')) return 'amd'
  if (model.startsWith('Arc')) return 'intel'
  throw new Error(`unknown vendor for model ${model}`)
}
const slugOf = (model) =>
  model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const families = new Set(dictionary.map((entry) => entry.family ?? entry.productKey))
for (const gpu of partPatterns.gpuModels) {
  if (!families.has(gpu.model)) throw new Error(`gpuModel ${gpu.model} has no dictionary family`)
  const vendor = vendorOf(gpu.model)
  const catalogueId = `gpu:${vendor}:${slugOf(gpu.model)}:mobile`
  items.push({
    catalogueId,
    kind: 'gpu',
    family: gpu.model,
    variant: 'mobile',
    isMobile: true,
    packId: 'gpu-pc',
    name: `${gpu.model} (Laptop)`,
  })
  for (const alias of aliasesByFamily.get(gpu.model) ?? []) {
    aliasRows.push({ catalogueId, alias, source: 'pack:gpu-pc:mobile' })
  }
}

// A Dell OptiPlex model number ("OptiPlex 3080", "OptiPlex 3090") must never resolve to the RTX
// 3080 or RTX 3090 (docs/design/modules/product-catalogue.md); the same pattern
// packages/packs/src/dictionary.ts blanks before GPU matching.
const OPTIPLEX_PATTERN = '\\boptiplex\\s*(ultra\\s*)?\\d{4}\\b'
const negativeContexts = dictionary
  .filter((entry) => entry.family === 'RTX 3080' || entry.family === 'RTX 3090')
  .map((entry) => ({
    pattern: OPTIPLEX_PATTERN,
    blockedCatalogueId: entry.productKey,
    source: 'pack:gpu-pc',
  }))

const valuesClause = (rows, columns) =>
  rows.map((row) => `  (${columns.map((c) => sqlValue(row[c])).join(', ')})`).join(',\n')

const itemsClause = items
  .map(
    (i) =>
      `  (${sqlValue(i.catalogueId)}, ${sqlValue(i.kind)}, ${sqlValue(i.family)}, ${sqlValue(i.variant)}, ${i.isMobile}, ${sqlValue(i.packId)}, ${sqlValue(i.name)})`,
  )
  .join(',\n')

const sql = `-- product-catalogue: seed rows from the gpu-pc pack (packages/packs/gpu-pc/data), generated
-- from its dictionary (desktop GPUs and CPUs) and part-patterns.json's gpuModels (the mobile
-- counterpart of each canonical model; the pack carries no laptop GPU data, so a mobile item's own
-- VRAM is not stated -- never a guess, docs/packs/gpu-pc.md). Regenerate with
-- generate-seed.mjs in this folder whenever the pack's data changes.

insert into product_catalogue.items (catalogue_id, kind, family, variant, is_mobile, pack_id, name) values
${itemsClause}
on conflict (catalogue_id) do nothing;

insert into product_catalogue.aliases (catalogue_id, alias, source) values
${valuesClause(aliasRows, ['catalogueId', 'alias', 'source'])}
on conflict (catalogue_id, alias) do nothing;

insert into product_catalogue.negative_contexts (pattern, blocked_catalogue_id, source) values
${valuesClause(negativeContexts, ['pattern', 'blockedCatalogueId', 'source'])}
on conflict (pattern, blocked_catalogue_id) do nothing;
`

process.stdout.write(sql)
console.error(
  `items ${items.length}, aliases ${aliasRows.length}, codes ${codeRows.length} (not seeded: no codes yet in the pack), negative contexts ${negativeContexts.length}`,
)
