// pnpm interfaces
// Reads every services/<module>/README.md and writes docs/design/modules/_interfaces.md: one
// short block per module listing its exported functions, views and events, taken from the
// README's "Inputs", "Outputs" and "Tables" sections or their equivalents ("Owned tables",
// "Views", "Events" — the older module template, docs/design/modules/_rules.md rule 15 vs the
// scaffold before task 0.13). Section headings are kept exactly as the module's README spells
// them: this script never renames "Owned tables" to "Tables".
//
// Discovery is by directory, like the fixtures runner (fixtures/README.md): no module registers
// itself anywhere else, so a module built on a parallel branch appears here the next time this
// script runs, with no shared file to conflict over.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Section headings this digest pulls from, case-insensitively, kept in their own spelling. */
const WANTED_HEADINGS = new Set(['inputs', 'outputs', 'tables', 'owned tables', 'views', 'events'])

/** A block never runs longer than this many lines (CLAUDE.md, "Working economy: short outputs"). */
export const MAX_BLOCK_LINES = 24

/** The module's H1 title and, if present, the one-sentence tagline straight after it. */
export function titleAndTagline(markdown) {
  const lines = markdown.split('\n')
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line))
  if (titleIndex === -1) return { title: '', tagline: '' }
  const title = lines[titleIndex].replace(/^#\s+/, '').trim()
  for (let i = titleIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    if (line.startsWith('#')) break
    return { title, tagline: line }
  }
  return { title, tagline: '' }
}

/** Every `## Heading` section as `{ heading, body }`, body as its raw lines (no leading `##`). */
export function sections(markdown) {
  const result = []
  let current = null
  for (const line of markdown.split('\n')) {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (match) {
      current = { heading: match[1], body: [] }
      result.push(current)
    } else if (current) {
      current.body.push(line)
    }
  }
  return result
}

/** This module's Inputs/Outputs/Tables sections (or their equivalents), in README order. */
export function wantedSections(allSections) {
  return allSections.filter((section) => WANTED_HEADINGS.has(section.heading.trim().toLowerCase()))
}

/**
 * A section body as logical items: one per bullet, numbered entry or table row, with a wrapped
 * continuation line folded into the item above it. A section with prose and no list (for example
 * "None.") becomes one item.
 */
const BULLET = /^(?:-|\*|\d+[.)])\s+(.*)$/
const TABLE_SEPARATOR_ROW = /^\|[\s:|-]+\|$/

export function items(body) {
  const result = []
  for (const raw of body) {
    const line = raw.trim()
    if (line === '') continue
    const bullet = BULLET.exec(line)
    if (bullet) {
      // Strip the marker: buildBlock adds its own "- " so a source bullet never doubles up.
      result.push(bullet[1])
    } else if (line.startsWith('|')) {
      if (!TABLE_SEPARATOR_ROW.test(line)) result.push(line)
    } else if (result.length === 0) {
      result.push(line)
    } else {
      result[result.length - 1] += ` ${line}`
    }
  }
  return result
}

/** Truncates one logical line to stay short, never mid-word where avoidable. */
export function condense(text, maxLength = 110) {
  if (text.length <= maxLength) return text
  const cut = text.slice(0, maxLength - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** One module's digest block: its name, tagline, and its wanted sections as condensed bullets. */
export function buildBlock(moduleName, readme, maxLines = MAX_BLOCK_LINES) {
  const { tagline } = titleAndTagline(readme)
  const lines = [`## ${moduleName}`]
  if (tagline) lines.push(condense(tagline))
  for (const section of wantedSections(sections(readme))) {
    const its = items(section.body)
    if (its.length === 0) continue
    lines.push(`**${section.heading}:**`)
    for (const it of its) lines.push(`- ${condense(it)}`)
  }
  if (lines.length <= maxLines) return lines.join('\n')
  return [...lines.slice(0, maxLines - 1), '- …'].join('\n')
}

/** The whole digest: a header, then one block per `services/<module>/README.md`, sorted by name. */
export function buildDigest(servicesDir) {
  const modules = readdirSync(servicesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const blocks = modules
    .map((name) => {
      const readmePath = join(servicesDir, name, 'README.md')
      if (!existsSync(readmePath)) return null
      return buildBlock(name, readFileSync(readmePath, 'utf8'))
    })
    .filter((block) => block !== null)
  const header = [
    '<!-- generated by scripts/interface-digest.mjs; edit freely -->',
    '',
    '# Module interfaces',
    '',
    'One short block per `services/<module>/README.md`: its exported functions, views and events,',
    "taken from the README's Inputs, Outputs and Tables sections (or their equivalents). Run",
    '`pnpm interfaces` to refresh after a README changes; nothing here is hand-maintained.',
  ].join('\n')
  return `${header}\n\n${blocks.join('\n\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const servicesDir = join(root, 'services')
  const outPath = join(root, 'docs/design/modules/_interfaces.md')
  writeFileSync(outPath, buildDigest(servicesDir))
  console.log(`wrote ${relative(root, outPath)}`)
}
