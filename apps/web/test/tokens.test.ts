import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * WCAG AA contrast for the design tokens in src/app/globals.css, in both themes: 4.5:1 for text,
 * 3:1 for component boundaries and non-text indicators.
 */

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')

function tokens(selector: ':root' | '.dark'): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf('}', start))
  const entries = [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/g)].map(
    (match) => [match[1], match[2]] as [string, string],
  )
  return Object.fromEntries(entries)
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** [foreground, background, minimum ratio] */
const pairs: Array<[string, string, number]> = [
  ['foreground', 'background', 4.5],
  ['foreground', 'surface', 4.5],
  ['foreground', 'muted', 4.5],
  ['foreground', 'subtle', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['surface-foreground', 'surface', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'surface', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['muted-foreground', 'popover', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['primary-foreground', 'primary-hover', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['link', 'background', 4.5],
  ['link', 'card', 4.5],
  ['success-foreground', 'success', 4.5],
  ['success-foreground', 'card', 4.5],
  ['warning-foreground', 'warning', 4.5],
  ['warning-foreground', 'card', 4.5],
  ['danger-foreground', 'danger', 4.5],
  ['info-foreground', 'info', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['placeholder-foreground', 'placeholder', 4.5],
  ['input', 'background', 3],
  ['input', 'card', 3],
  ['ring', 'background', 3],
  ['ring', 'card', 3],
  ['position-marker', 'position-track', 3],
  ['position-marker', 'card', 3],
  ['primary', 'background', 3],
]

describe.each([':root', '.dark'] as const)('%s tokens', (selector) => {
  const theme = tokens(selector)

  it('defines every token the pairs use', () => {
    for (const [fg, bg] of pairs) {
      expect(theme[fg], fg).toMatch(/^#[0-9a-f]{6}$/)
      expect(theme[bg], bg).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it.each(pairs)('%s on %s meets %s:1', (fg, bg, minimum) => {
    const ratio = contrast(theme[fg] ?? '#000000', theme[bg] ?? '#000000')
    expect(ratio).toBeGreaterThanOrEqual(minimum)
  })
})
