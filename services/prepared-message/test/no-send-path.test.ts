import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as api from '../src'

// The card's test: no send path exists. Nabvy never contacts sellers; the user copies the text.
// The module exports only builders and contracts, depends on no transport or delivery package,
// and its source makes no network call and names no channel.

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  )

describe('no send path', () => {
  it('writes nothing: no insert, update or delete in the source', () => {
    for (const file of sources(join(root, 'src'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /\.(insert|update|delete)\(|\b(insert into|update \w|delete from)\b/i,
      )
    }
  })

  it('exports builders and contracts only', () => {
    const functions = Object.entries(api)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort()
    expect(functions).toEqual(['build', 'buildMany', 'compose', 'showQuote'])
  })

  it('depends on no transport, notifier, channel or HTTP package', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(
      deps.filter((d) => /transport|notifier|telegram|email|push|http|fetch|axios|apify/i.test(d)),
    ).toEqual([])
  })

  it('no source file sends, fetches or names a channel', () => {
    for (const file of sources(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
      expect(text, file).not.toMatch(
        /\bfetch\(|https?:\/\/|\bsend[A-Z(]|\bpublish\(|telegram|smtp|webhook|apify/i,
      )
    }
  })
})
