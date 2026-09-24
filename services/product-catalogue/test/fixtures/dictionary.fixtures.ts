import { readFileSync } from 'node:fs'
import { getPack } from '@nabvy/packs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { resolveDictionary } from '../../src/domain'

// Stage `dictionary`: the desktop items and aliases seeded from the gpu-pc pack's own dictionary
// (packages/db/migrations/product-catalogue/) must resolve the pack's own alias fixtures the same
// way its in-process resolver does (services/product-catalogue/README.md, "Fixtures and pass
// rate"; docs/design/modules/product-catalogue.md, "the pack's alias fixtures").

const AliasFixtures = z.strictObject({
  about: z.string(),
  cases: z
    .array(
      z.strictObject({
        text: z.string().min(1),
        family: z.string().nullable(),
        productKey: z.string().nullable(),
      }),
    )
    .min(1),
})
const { cases } = AliasFixtures.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../../packages/packs/test/fixtures/aliases.json', import.meta.url),
      'utf8',
    ),
  ),
)

// Every desktop item and CPU the pack's dictionary seeds (excludes this module's own mobile
// items, which the pack has no data for, and admin-added rows, which the fixtures never see).
const { dictionary } = getPack('gpu-pc').definition
const items = dictionary.map((entry) => ({
  catalogueId: entry.productKey,
  kind: entry.productKey.split(':')[0] as 'gpu' | 'cpu',
  family: entry.family ?? null,
  name: entry.name,
  variant: entry.vramGb ? `${entry.vramGb}gb` : null,
  isMobile: false,
}))
const aliases = dictionary.flatMap((entry) => [
  ...entry.aliases.map((alias) => ({
    catalogueId: entry.productKey,
    alias,
    source: 'pack:gpu-pc',
  })),
  ...entry.patterns.map((pattern) => ({
    catalogueId: entry.productKey,
    alias: pattern,
    source: 'pack:gpu-pc:pattern',
  })),
])

describe('product-catalogue dictionary (gpu-pc pack alias fixtures)', () => {
  it.each(cases)('resolves "$text"', ({ text, family, productKey }) => {
    const [first] = resolveDictionary(text, items, aliases, [])
    expect(first?.family ?? null).toBe(family)
    expect(first?.catalogueId ?? null).toBe(productKey)
  })
})
