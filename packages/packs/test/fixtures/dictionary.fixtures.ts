import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getPack } from '../../src'

// Stage `dictionary`: the gpu-pc dictionary resolves the alias fixtures (task 0.4).

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
  JSON.parse(readFileSync(new URL('./aliases.json', import.meta.url), 'utf8')),
)
const pack = getPack('gpu-pc')

describe('gpu-pc dictionary', () => {
  it.each(cases)('resolves "$text"', ({ text, family, productKey }) => {
    const [first] = pack.resolve(text)
    expect(first?.family ?? null).toBe(family)
    expect(first?.productKey ?? null).toBe(productKey)
  })
})
