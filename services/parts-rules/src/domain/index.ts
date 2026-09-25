// Pure logic of the parts-rules module: no I/O.
import { createHash } from 'node:crypto'

export { CORE_PARTS, partGaps } from './gaps'
export {
  type Analysis,
  analyse,
  attributeLabel,
  attrsOf,
  type CompiledRules,
  compileRules,
  cpuKey,
  decideKind,
  FIELD_PART_TYPES,
  gpuKey,
  type Hit,
  inclusionOf,
  type ListingText,
  lineLabel,
  OPTIPLEX,
  RULES_REVISION,
  type RuleSettings,
  ruleVersion,
  type Signal,
  type TagBlock,
  tagBlocksIn,
} from './rules'
export { readsPlusAsSpace, workingCopy } from './text'

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The `parts-rules.ran` key: the rule version and every (listing, evidence hash) of the batch,
 * sorted, hashed. A replay of the same versions gives the same key, which the transport drops;
 * a new version of any listing gives a new one.
 */
export function ranKey(
  version: string,
  runs: { listingId: string; evidenceHash: string }[],
  i: number,
) {
  const body = runs
    .map((r) => `${r.listingId}@${r.evidenceHash}`)
    .sort()
    .join(',')
  const digest = createHash('sha256').update(`${version}|${body}`).digest('hex')
  return `parts-rules.ran:${version}:${digest}:${i}`
}

/**
 * A catalogue match is kept only if every model number it names (three or more digits) appears
 * in the quote, so a fuzzy match can never turn "GTX 970" into another card. A series number
 * ("Ryzen 7 2000 series") agrees with a quoted number of the same length and first digit
 * ("2700X").
 */
export function numbersAgree(family: string, reading: string): boolean {
  const quoted: string[] = reading.match(/\d+/g) ?? []
  return (family.match(/\d{3,}/g) ?? []).every(
    (n) =>
      quoted.includes(n) ||
      (/^\d0+$/.test(n) && quoted.some((q) => q.length === n.length && q[0] === n[0])),
  )
}
