import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getPack } from '../../src'

// Stage `gate`: the gpu-pc title gate and the destructive wanted_post drop on labelled titles.

const GateTitles = z.strictObject({
  about: z.string(),
  cases: z
    .array(
      z.strictObject({
        title: z.string().min(1),
        gate: z.enum(['in', 'out']),
        wantedDrop: z.boolean(),
      }),
    )
    .min(1),
})
const { cases } = GateTitles.parse(
  JSON.parse(readFileSync(new URL('./gate-titles.json', import.meta.url), 'utf8')),
)
const pack = getPack('gpu-pc')
const wantedPost = pack.risk.find((rule) => rule.flag === 'wanted_post')

describe('gpu-pc title gate', () => {
  it.each(cases)('"$title" gates $gate', ({ title, gate }) => {
    expect(pack.gate.passesTitle(title) ? 'in' : 'out').toBe(gate)
  })
})

describe('gpu-pc wanted_post drop', () => {
  it.each(cases)('"$title" drops: $wantedDrop', ({ title, wantedDrop }) => {
    expect(wantedPost?.patterns.some((regex) => regex.test(title))).toBe(wantedDrop)
  })
})
