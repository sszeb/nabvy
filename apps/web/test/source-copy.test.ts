import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Copy rules over the screen source (docs/web-app.md, "Copy rules", and the Precedence table):
 * outside comments, no screen or component names another marketplace or price source, calls an
 * ask "worth" or a "fair value", mentions relisting or scores, or reads process.env.
 */

const root = new URL('../src/', import.meta.url).pathname

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(tsx?|css)$/.test(name) ? [path] : []
  })
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const forbidden: Array<[string, RegExp]> = [
  ['other marketplaces or price sources', /\b(eBay|CeX|Gumtree|Vinted)\b/],
  ['worth or fair-value wording', /\b(worth|fair value|fair price|market value)\b/i],
  ['relist wording', /\b(relisted|seen before)\b/i],
  ['scores', /\b(deal score|risk score|scam score)\b/i],
  ['urgency', /\b(hurry|don['’]t miss|last chance|act now)\b/i],
]

describe('screen source', () => {
  const sources = files(root).map((path) => ({
    path,
    text: withoutComments(readFileSync(path, 'utf8')),
  }))

  it('finds the source files', () => {
    expect(sources.length).toBeGreaterThan(20)
  })

  it.each(forbidden)('contains no %s', (_name, pattern) => {
    const hits = sources.filter((source) => pattern.test(source.text)).map((source) => source.path)
    expect(hits).toEqual([])
  })

  it('never renders an <img> for a listing photo', () => {
    const hits = sources
      .filter((source) => /<img\b|next\/image/.test(source.text))
      .map((source) => source.path)
    expect(hits).toEqual([])
  })
})
