import { describe, expect, it } from 'vitest'
import { RESERVED_SCHEMAS as SCAFFOLD_RESERVED } from '../../../scripts/new-module.mjs'
import { moduleSchema, RESERVED_SCHEMAS, schemaNameOf } from '../src/index'

describe('module schemas', () => {
  it('maps a kebab-case module to its snake-case schema', () => {
    expect(schemaNameOf('listing-registry')).toBe('listing_registry')
    expect(moduleSchema('copy-advert-spam').schemaName).toBe('copy_advert_spam')
  })

  it('refuses reserved and malformed names', () => {
    for (const name of ['auth', 'storage', 'public', 'extensions', 'nabvy-core', 'pg-stat']) {
      expect(() => schemaNameOf(name)).toThrow()
    }
    expect(() => schemaNameOf('Listing_Registry')).toThrow(/kebab/)
  })

  it('reserves the same schemas as the scaffold', () => {
    expect([...RESERVED_SCHEMAS].sort()).toEqual([...SCAFFOLD_RESERVED].sort())
  })
})
