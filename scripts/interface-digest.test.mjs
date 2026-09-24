// node --test scripts/interface-digest.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import {
  buildBlock,
  buildDigest,
  condense,
  items,
  MAX_BLOCK_LINES,
  sections,
  titleAndTagline,
  wantedSections,
} from './interface-digest.mjs'

const README_RULE15 = `# @nabvy/usage-ledger

Keeps each user's credit balance and charges metered actions against it.

## Switch and priority

Off by default.

## Inputs

- \`grant()\` calls from \`subscriptions\`.
- Reads: \`@nabvy/switches\`' \`state(q, 'usage-ledger')\`.

## Outputs

- **Functions**: \`grant(q, input)\`, \`chargeUsage(q, input)\`, \`getBalance(q, userId)\`.
- **Event** \`usage-ledger.balance-low\` v1.
- **Internal view** \`usage_ledger.v_balances\`.

## Tables

- \`entries\`: the append-only ledger.
- \`buckets\`: one per grant.

## Decisions

Nothing here matters for the digest.
`

const README_OLD_TEMPLATE = `# @nabvy/auth

Sessions, roles and account standing.

## Inputs

- HTTP requests to \`/api/auth/*\`.

## Outputs

| Export | For |
| --- | --- |
| \`getSession(headers)\` | the signed-in session |

## Owned tables

Postgres schema \`better_auth\`.

## Views

None.

## Events

None yet.
`

const README_NO_SECTIONS = `# @nabvy/source-adapters

## Facebook Marketplace actor (task 1.0)

Nothing the digest wants here.
`

describe('titleAndTagline', () => {
  it('reads the H1 and the sentence right after it', () => {
    assert.deepEqual(titleAndTagline(README_RULE15), {
      title: '@nabvy/usage-ledger',
      tagline: "Keeps each user's credit balance and charges metered actions against it.",
    })
  })

  it('is blank when there is no H1', () => {
    assert.deepEqual(titleAndTagline('## Inputs\n\nsomething'), { title: '', tagline: '' })
  })
})

describe('sections', () => {
  it('splits on ## headings, keeping body lines', () => {
    const found = sections(README_RULE15)
    assert.deepEqual(
      found.map((s) => s.heading),
      ['Switch and priority', 'Inputs', 'Outputs', 'Tables', 'Decisions'],
    )
    assert.ok(found.find((s) => s.heading === 'Inputs').body.some((l) => l.includes('grant()')))
  })
})

describe('wantedSections', () => {
  it('keeps Inputs, Outputs, Tables case-insensitively and in order', () => {
    const names = wantedSections(sections(README_RULE15)).map((s) => s.heading)
    assert.deepEqual(names, ['Inputs', 'Outputs', 'Tables'])
  })

  it('accepts the older template’s Owned tables, Views and Events, spelled as written', () => {
    const names = wantedSections(sections(README_OLD_TEMPLATE)).map((s) => s.heading)
    assert.deepEqual(names, ['Inputs', 'Outputs', 'Owned tables', 'Views', 'Events'])
  })

  it('is empty when a README has none of the wanted headings', () => {
    assert.deepEqual(wantedSections(sections(README_NO_SECTIONS)), [])
  })
})

describe('items', () => {
  it('makes one item per bullet and folds a wrapped continuation into it', () => {
    const found = items([
      '- `grant()` calls from `subscriptions` (top-up Checkout webhook, the monthly',
      '  allowance, the taste) and `attribution` (referral credit), in the pipeline.',
      '- `chargeUsage()` and `reverseCharge()` calls from the module that runs a metered',
      '  action.',
    ])
    assert.equal(found.length, 2)
    assert.ok(found[0].includes('subscriptions') && found[0].includes('pipeline.'))
    assert.ok(found[1].includes('chargeUsage()') && found[1].includes('action.'))
  })

  it('keeps a table as one row per item, dropping the separator row', () => {
    const found = items(['| Export | For |', '| --- | --- |', '| `grant()` | subs |'])
    assert.deepEqual(found, ['| Export | For |', '| `grant()` | subs |'])
  })

  it('strips the bullet marker so buildBlock never doubles it up', () => {
    assert.deepEqual(items(['- `grant()` does a thing', '* another one', '1. numbered']), [
      '`grant()` does a thing',
      'another one',
      'numbered',
    ])
  })

  it('treats prose with no bullet as one item', () => {
    assert.deepEqual(items(['None.']), ['None.'])
  })

  it('skips blank lines and ignores an empty section', () => {
    assert.deepEqual(items(['', '  ', '']), [])
  })
})

describe('condense', () => {
  it('leaves a short line alone', () => {
    assert.equal(condense('short'), 'short')
  })

  it('truncates a long line at a word boundary with an ellipsis', () => {
    const long = 'a '.repeat(80).trim()
    const short = condense(long, 50)
    assert.ok(short.length <= 51, short)
    assert.ok(short.endsWith('…'))
    assert.ok(!short.slice(0, -1).endsWith(' '))
  })
})

describe('buildBlock', () => {
  it('produces a heading, tagline and one bullet list per wanted section', () => {
    const block = buildBlock('usage-ledger', README_RULE15)
    assert.ok(block.startsWith('## usage-ledger\n'))
    assert.ok(block.includes("Keeps each user's credit balance"))
    assert.ok(block.includes('**Inputs:**'))
    assert.ok(block.includes('**Outputs:**'))
    assert.ok(block.includes('**Tables:**'))
    assert.ok(!block.includes('Decisions'))
  })

  it('never exceeds the line budget, even for a very long README', () => {
    const manyBullets = Array.from({ length: 60 }, (_, i) => `- \`fn${i}()\` does a thing`).join(
      '\n',
    )
    const readme = `# @nabvy/big\n\nA module with a lot to say.\n\n## Outputs\n\n${manyBullets}\n`
    const block = buildBlock('big', readme, MAX_BLOCK_LINES)
    assert.ok(block.split('\n').length <= MAX_BLOCK_LINES, block.split('\n').length)
    assert.ok(block.endsWith('- …'))
  })

  it('still produces a block, just a bare one, when no wanted heading exists', () => {
    const block = buildBlock('source-adapters', README_NO_SECTIONS)
    assert.equal(block, '## source-adapters')
  })
})

describe('buildDigest', () => {
  const roots = []
  after(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function servicesDir(readmes) {
    const root = mkdtempSync(join(tmpdir(), 'nabvy-interface-digest-'))
    roots.push(root)
    for (const [name, readme] of Object.entries(readmes)) {
      mkdirSync(join(root, name), { recursive: true })
      writeFileSync(join(root, name, 'README.md'), readme)
    }
    // A file directly under services/ (like the real services/README.md) is not a module.
    writeFileSync(join(root, 'README.md'), '# services\n')
    return root
  }

  it('writes one block per module, sorted by name, skipping non-module files', () => {
    const dir = servicesDir({ 'usage-ledger': README_RULE15, auth: README_OLD_TEMPLATE })
    const digest = buildDigest(dir)
    assert.ok(digest.startsWith('<!-- generated by scripts/interface-digest.mjs; edit freely -->'))
    assert.ok(digest.indexOf('## auth') < digest.indexOf('## usage-ledger'))
    assert.equal((digest.match(/^## /gm) ?? []).length, 2)
  })

  it('skips a module with no README.md instead of failing', () => {
    const dir = servicesDir({ 'usage-ledger': README_RULE15 })
    mkdirSync(join(dir, 'no-readme-yet'))
    const digest = buildDigest(dir)
    assert.ok(!digest.includes('no-readme-yet'))
  })
})
