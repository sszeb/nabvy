// Pure logic of the warning-signs module: no I/O. Text rules over the title and a full
// description, the assessment's cautions and exclusions, and each index group's figures give the
// listing's warning facts, each with its evidence, rule ID and rule version (README.md, "Rules
// and thresholds"). No scores and no labels.

import { createHash } from 'node:crypto'
import type { WarningSignsRules } from '@nabvy/config/modules/warning-signs'
import type {
  WarningSignsContactKind,
  WarningSignsEvidence,
  WarningSignsFactCode,
  WarningSignsLowAskReason,
  WarningSignsPayKind,
} from '@nabvy/contracts/modules/warning-signs'
import { redact } from '@nabvy/quote-redaction'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** One index group the listing's ask is a member of, with the group's figures. */
export interface GroupAsk {
  groupKey: string
  /** The figures' version (asking-price-index `as_of`), ISO. */
  asOf: string
  askMinor: number
  medianMinor: number | null
  n: number | null
  currency: string
}

/** A part listing-assessment says the listing expressly leaves out. */
export interface ExclusionInput {
  partType: string
  /** The record's part carrying the exclusion; null for a phrase such as "no GPU". */
  seq: number | null
}

/** Everything one evaluation reads for a listing's current version. */
export interface EvaluateInput {
  listingId: string
  evidenceHash: string
  cardHash: string
  title: string
  description: string | null
  descriptionStatus: string
  /** T1 of the input (listing-ingest `first_fetched_at`). */
  fetchedAt: Date | null
  /** listing-assessment's cautions for this version; null when it has not assessed it. */
  cautions: string[] | null
  exclusions: ExclusionInput[] | null
  groups: GroupAsk[]
}

/** One fact an evaluation found. */
export interface FoundFact {
  code: WarningSignsFactCode
  reason: WarningSignsLowAskReason | null
  evidence: WarningSignsEvidence
  /** The redacted quote, for the user-facing view; null for a fact with no quote. */
  evidenceText: string | null
  ruleId: string
}

/** The result of one evaluation. */
export interface Evaluation {
  listingId: string
  evidenceHash: string
  cardHash: string
  inputHash: string
  ruleVersion: string
  fetchedAt: Date | null
  facts: FoundFact[]
}

/** The rule version of a rule set: `w<generation>.<first 8 hex of its digest>`. */
export function ruleVersion(rules: WarningSignsRules): string {
  return `w${rules.ruleGeneration}.${sha256(JSON.stringify(rules)).slice(0, 8)}`
}

const byKey = <T>(rows: readonly T[], key: (r: T) => string) =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))

/**
 * The SHA-256 of everything an evaluation reads, in a stable order: a new text, card, caution,
 * exclusion or group figure changes it; a replay does not (rule 8, a cross-listing stage).
 */
export function inputHash(input: EvaluateInput): string {
  return sha256(
    JSON.stringify([
      input.title,
      input.description,
      input.descriptionStatus,
      input.cardHash,
      input.cautions === null ? null : [...input.cautions].sort(),
      input.exclusions === null
        ? null
        : byKey(input.exclusions, (e) => `${e.partType}:${e.seq}`).map((e) => [e.partType, e.seq]),
      byKey(input.groups, (g) => g.groupKey).map((g) => [
        g.groupKey,
        g.asOf,
        g.askMinor,
        g.medianMinor,
        g.n,
        g.currency,
      ]),
    ]),
  )
}

// --- Phrase matching ---------------------------------------------------------------------------

/** Letters a digit may stand for (the design's L2 notes: 0→o, 1→i or l, 3→e, 5→s). */
const DIGIT_FOR = { o: '0', i: '1', l: '1', e: '3', s: '5' } as const
const ESCAPE = /[.*+?^${}()|[\]\\]/g
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}])'
const EDGE_AFTER = '(?![\\p{L}\\p{N}])'

/** A case-insensitive, word-bounded pattern for a phrase, with separators and digit spellings. */
export function phrasePattern(phrase: string): string {
  let out = ''
  for (const ch of phrase.toLowerCase()) {
    if (ch === ' ' || ch === '-' || ch === '/') out += '[\\s+\\-/]+'
    else if (ch === "'" || ch === '’') out += "['’]?"
    else if (ch in DIGIT_FOR) out += `[${ch}${DIGIT_FOR[ch as keyof typeof DIGIT_FOR]}]`
    else out += ch.replace(ESCAPE, '\\$&')
  }
  return `${EDGE_BEFORE}${out}${EDGE_AFTER}`
}

const listRegex = (list: readonly string[]) =>
  new RegExp(
    [...list]
      .sort((a, b) => b.length - a.length)
      .map(phrasePattern)
      .join('|'),
    'giu',
  )

/** Links whose host is checked against Facebook's (`isFacebookHost`). */
const LINK =
  /(?:https?:\/\/|www\.)[^\s]+|(?<![\p{L}\p{N}@.])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|co\.uk|org\.uk|uk|net|org|io|me|shop|store|biz|info)(?:\/[^\s]*)?(?![\p{L}\p{N}])/giu
const FACEBOOK_HOST = /(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/i

export function isFacebookHost(link: string): boolean {
  const host = link
    .replace(/^https?:\/\//i, '')
    .split(/[/?#]/)[0]
    ?.toLowerCase()
  return host !== undefined && FACEBOOK_HOST.test(host)
}

/** The configured lists, compiled once. */
export interface CompiledRules {
  rules: WarningSignsRules
  negators: RegExp
  pay: {
    friendsAndFamily: RegExp
    voucherGiftOrCrypto: RegExp
    deposit: RegExp
    bankTransfer: RegExp
    bankTransferClauseOnly: RegExp
    other: RegExp
    beforeCues: RegExp
    beforeCueExcept: RegExp
    exclusions: RegExp
  }
  lists: Record<
    | 'platformClaim'
    | 'awayStory'
    | 'contactApps'
    | 'urgency'
    | 'viewingOffered'
    | 'paymentOnCollection'
    | 'protectedPayment'
    | 'mining'
    | 'untested'
    | 'notWorking'
    | 'notWorkingExcept'
    | 'forParts'
    | 'stockPhrasing'
    | 'namedFault'
    | 'namedFaultExcept'
    | 'corePartMissing'
    | 'swapOrTrade'
    | 'offers'
    | 'cosmetic',
    RegExp
  >
  templateText: RegExp
}

export function compile(rules: WarningSignsRules): CompiledRules {
  const p = rules.payFirst
  return {
    rules,
    negators: new RegExp(`(?:${rules.negators.map(phrasePattern).join('|')})`, 'iu'),
    pay: {
      friendsAndFamily: listRegex(p.friendsAndFamily),
      voucherGiftOrCrypto: listRegex(p.voucherGiftOrCrypto),
      deposit: listRegex(p.deposit),
      bankTransfer: listRegex(p.bankTransfer),
      bankTransferClauseOnly: listRegex(p.bankTransferClauseOnly),
      other: listRegex(p.other),
      beforeCues: listRegex(p.beforeCues),
      beforeCueExcept: listRegex(p.beforeCueExcept),
      exclusions: listRegex(p.exclusions),
    },
    lists: {
      platformClaim: listRegex(rules.platformClaim),
      awayStory: listRegex(rules.awayStory),
      contactApps: listRegex(rules.contactApps),
      urgency: listRegex(rules.urgency),
      viewingOffered: listRegex(rules.viewingOffered),
      paymentOnCollection: listRegex(rules.paymentOnCollection),
      protectedPayment: listRegex(rules.protectedPayment),
      mining: listRegex(rules.mining),
      untested: listRegex(rules.untested),
      notWorking: listRegex(rules.notWorking),
      notWorkingExcept: listRegex(rules.notWorkingExcept),
      forParts: listRegex(rules.forParts),
      stockPhrasing: listRegex(rules.stockPhrasing),
      namedFault: listRegex(rules.namedFault),
      namedFaultExcept: listRegex(rules.namedFaultExcept),
      corePartMissing: listRegex(rules.corePartMissing),
      swapOrTrade: listRegex(rules.swapOrTrade),
      offers: listRegex(rules.offers),
      cosmetic: listRegex(rules.cosmetic),
    },
    templateText: new RegExp(
      rules.templateText.map((t) => t.replace(ESCAPE, '\\$&')).join('|'),
      'giu',
    ),
  }
}

/** A clause of the title or description, with its offsets in that text. */
export interface Clause {
  source: 'title' | 'description'
  text: string
  start: number
}

/**
 * Splits text into clauses at ! ? ; and line breaks, and at . or , followed by a space or the
 * end (so "M.2" and "£1,500" stay whole). Offsets are the stored text's.
 */
export function clauses(text: string, source: Clause['source']): Clause[] {
  const out: Clause[] = []
  const split = /[!?;\n\r]|[.,](?=\s|$)/gu
  let from = 0
  for (const m of text.matchAll(split)) {
    push(from, m.index)
    from = m.index + m[0].length
  }
  push(from, text.length)
  return out

  function push(start: number, end: number) {
    const raw = text.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (trimmed) out.push({ source, text: trimmed, start: start + lead })
  }
}

interface Hit {
  start: number
  end: number
}

/** Replaces each match of `re` with spaces, keeping offsets. */
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => ' '.repeat(m.length))
}

/** True when a negator is among the `window` words before `at` in the clause. */
function negated(c: CompiledRules, text: string, at: number, window: number): boolean {
  const words = text.slice(0, at).trim().split(/\s+/).filter(Boolean).slice(-window)
  return words.length > 0 && c.negators.test(words.join(' '))
}

/** Matches of `re` in the clause that no negator comes shortly before. */
function hits(c: CompiledRules, text: string, re: RegExp, window: number): Hit[] {
  const out: Hit[] = []
  for (const m of text.matchAll(re)) {
    if (!negated(c, text, m.index, window)) out.push({ start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** The clause as a stored quote: redacted, at most `quoteMaxChars` long. */
function quoteOf(c: CompiledRules, clause: Clause): { quote: string; start: number; end: number } {
  const quote = redact(clause.text).text.slice(0, c.rules.quoteMaxChars).trim()
  return { quote, start: clause.start, end: clause.start + clause.text.length }
}

type QuoteExtra = Partial<{
  payKind: WarningSignsPayKind
  beforeCue: boolean
  contactKind: WarningSignsContactKind
  state: 'not_working' | 'for_parts'
}>

function quoteFact(
  c: CompiledRules,
  code: WarningSignsFactCode,
  clause: Clause,
  extra: QuoteExtra = {},
  reason: WarningSignsLowAskReason | null = null,
): FoundFact {
  const q = quoteOf(c, clause)
  return {
    code,
    reason,
    evidence: { type: 'quote', source: clause.source, ...q, ...extra },
    evidenceText: q.quote,
    ruleId: `warning-signs.${code}`,
  }
}

/** The first clause with a non-negated match of `re`, after blanking `except`. */
function firstClause(
  c: CompiledRules,
  all: readonly Clause[],
  re: RegExp,
  except?: RegExp,
): Clause | undefined {
  return all.find((cl) => {
    const text = except ? blank(cl.text, except) : cl.text
    return hits(c, text, re, c.rules.negationWindowWords).length > 0
  })
}

// --- Pay first (the design, L2) ------------------------------------------------------------------

const PAY_ORDER: WarningSignsPayKind[] = [
  'friends_and_family',
  'voucher_gift_or_crypto',
  'deposit',
  'bank_transfer',
  'other',
]

/** The pay-first reading of one clause: the counted kind (the riskiest), or null. */
export function payFirstOf(
  c: CompiledRules,
  text: string,
): { kind: WarningSignsPayKind; beforeCue: boolean } | null {
  const w = c.rules.payNegationWindowWords
  const has = (re: RegExp) => hits(c, text, re, w).length > 0
  const ff = has(c.pay.friendsAndFamily)
  const voucher = has(c.pay.voucherGiftOrCrypto)
  const deposit = has(c.pay.deposit)
  const other = has(c.pay.other)
  const bank = has(c.pay.bankTransfer) || (has(c.pay.bankTransferClauseOnly) && (other || deposit))
  const beforeCue = c.pay.beforeCues.test(blank(text, c.pay.beforeCueExcept))
  c.pay.beforeCues.lastIndex = 0
  const excluded = has(c.pay.exclusions)
  const counted: Record<WarningSignsPayKind, boolean> = {
    friends_and_family: ff,
    voucher_gift_or_crypto: voucher,
    deposit,
    bank_transfer: bank && beforeCue && !excluded,
    other: other && beforeCue && !excluded,
  }
  const kind = PAY_ORDER.find((k) => counted[k])
  return kind ? { kind, beforeCue } : null
}

// --- Evaluation ----------------------------------------------------------------------------------

const MATERIAL: ReadonlySet<WarningSignsLowAskReason> = new Set([
  'not_working',
  'for_parts',
  'named_fault',
  'box_only',
  'core_part_missing',
  'part_not_included',
])

/** The group the ask sits furthest below, when it is far below (n ≥ minimum, ratio ≤ cut). */
export function lowestGroup(
  rules: WarningSignsRules,
  groups: readonly GroupAsk[],
): (GroupAsk & { medianMinor: number; n: number; ratio: number }) | null {
  let best: (GroupAsk & { medianMinor: number; n: number; ratio: number }) | null = null
  for (const g of groups) {
    if (g.n === null || g.medianMinor === null || g.medianMinor <= 0) continue
    if (g.n < rules.farBelowMinN) continue
    const ratio = Math.round((g.askMinor / g.medianMinor) * 1000) / 1000
    if (g.askMinor / g.medianMinor > rules.farBelowRatio) continue
    if (!best || ratio < best.ratio || (ratio === best.ratio && g.groupKey < best.groupKey)) {
      best = { ...g, medianMinor: g.medianMinor, n: g.n, ratio }
    }
  }
  return best
}

/** Evaluates one listing version: every fact the rules find, in code order. */
export function evaluateOne(input: EvaluateInput, c: CompiledRules, version: string): Evaluation {
  const facts: FoundFact[] = []
  const full = input.descriptionStatus === 'full_verified'
  const text: Clause[] = [
    ...clauses(input.title, 'title'),
    ...(full && input.description ? clauses(input.description, 'description') : []),
  ]
  const L = c.lists
  const phraseFact = (code: WarningSignsFactCode, re: RegExp, except?: RegExp) => {
    const clause = firstClause(c, text, re, except)
    if (clause) facts.push(quoteFact(c, code, clause))
  }

  // Pay first: the riskiest counted kind over all clauses.
  let pay: { clause: Clause; kind: WarningSignsPayKind; beforeCue: boolean } | null = null
  for (const clause of text) {
    const p = payFirstOf(c, clause.text)
    if (p && (!pay || PAY_ORDER.indexOf(p.kind) < PAY_ORDER.indexOf(pay.kind)))
      pay = { clause, ...p }
  }
  if (pay) {
    facts.push(
      quoteFact(c, 'pay_first_text', pay.clause, { payKind: pay.kind, beforeCue: pay.beforeCue }),
    )
  }

  // Platform claim: a phrase, or a link that is not Facebook's.
  const claim = text.find(
    (cl) =>
      hits(c, cl.text, L.platformClaim, c.rules.negationWindowWords).length > 0 ||
      [...cl.text.matchAll(LINK)].some((m) => !isFacebookHost(m[0])),
  )
  if (claim) facts.push(quoteFact(c, 'platform_claim_text', claim))

  phraseFact('away_story_text', L.awayStory)

  // Off-platform contact: quote-redaction's detectors, a messaging app, or a non-Facebook link.
  for (const cl of text) {
    const masked = redact(cl.text).masked
    const kind: WarningSignsContactKind | null =
      masked.phone > 0
        ? 'phone'
        : masked.email > 0
          ? 'email'
          : [...cl.text.matchAll(LINK)].some((m) => !isFacebookHost(m[0]))
            ? 'link'
            : hits(c, cl.text, L.contactApps, c.rules.negationWindowWords).length > 0
              ? 'app'
              : null
    if (kind) {
      facts.push(quoteFact(c, 'off_platform_contact_text', cl, { contactKind: kind }))
      break
    }
  }

  phraseFact('urgency_text', L.urgency)

  // Thin text: a full description shorter than the cut once template text is removed.
  if (full) {
    const left = (input.description ?? '').replace(c.templateText, ' ').replace(/\s+/gu, ' ').trim()
    const chars = [...left].length
    if (chars < c.rules.thinTextMaxChars) {
      facts.push({
        code: 'thin_text',
        reason: null,
        evidence: { type: 'value', source: 'description', value: null, chars },
        evidenceText: null,
        ruleId: 'warning-signs.thin_text',
      })
    }
  }

  phraseFact('viewing_offered_text', L.viewingOffered)

  // Payment on collection, unless the same clause demands a deposit.
  const onCollection = text.find(
    (cl) =>
      hits(c, cl.text, L.paymentOnCollection, c.rules.negationWindowWords).length > 0 &&
      hits(c, cl.text, c.pay.deposit, c.rules.payNegationWindowWords).length === 0,
  )
  if (onCollection) facts.push(quoteFact(c, 'payment_on_collection_text', onCollection))

  phraseFact('protected_payment_text', L.protectedPayment)

  const boxOnly = input.cautions?.includes('box_only') ?? false
  if (boxOnly) {
    facts.push({
      code: 'box_only',
      reason: null,
      evidence: { type: 'value', source: 'assessment', value: 'box_only' },
      evidenceText: null,
      ruleId: 'warning-signs.box_only',
    })
  }

  phraseFact('mining_text', L.mining)
  phraseFact('untested_text', L.untested)

  const notWorking = firstClause(c, text, L.notWorking, L.notWorkingExcept)
  const forParts = firstClause(c, text, L.forParts)
  const state = notWorking ?? forParts
  if (state) {
    facts.push(
      quoteFact(c, 'not_working_text', state, {
        state: notWorking ? 'not_working' : 'for_parts',
      }),
    )
  }

  phraseFact('stock_phrasing_text', L.stockPhrasing)

  // An ask far below similar asks, and the wording that may explain it.
  const low = lowestGroup(c.rules, input.groups)
  if (low) {
    const reasons: FoundFact[] = []
    const wording = (reason: WarningSignsLowAskReason, clause: Clause | undefined) => {
      if (clause) reasons.push(quoteFact(c, 'low_ask_explained', clause, {}, reason))
    }
    const value = (reason: WarningSignsLowAskReason, v: string) =>
      reasons.push({
        code: 'low_ask_explained',
        reason,
        evidence: { type: 'value', source: 'assessment', value: v },
        evidenceText: null,
        ruleId: 'warning-signs.low_ask_explained',
      })
    wording('not_working', notWorking)
    wording('for_parts', forParts)
    wording('named_fault', firstClause(c, text, L.namedFault, L.namedFaultExcept))
    if (boxOnly) value('box_only', 'box_only')
    const coreText = firstClause(c, text, L.corePartMissing)
    const coreExcluded = (input.exclusions ?? []).find(
      (e) => e.seq === null && c.rules.corePartTypes.includes(e.partType),
    )
    if (coreText) wording('core_part_missing', coreText)
    else if (coreExcluded) value('core_part_missing', coreExcluded.partType)
    const notIncluded = (input.exclusions ?? []).find((e) => e.seq !== null)
    if (notIncluded) value('part_not_included', notIncluded.partType)
    wording('swap_or_trade', firstClause(c, text, L.swapOrTrade))
    wording('offers', firstClause(c, text, L.offers))
    wording('cosmetic', firstClause(c, text, L.cosmetic))

    if (!reasons.some((r) => r.reason !== null && MATERIAL.has(r.reason))) {
      facts.push({
        code: 'ask_far_below_similar',
        reason: null,
        evidence: {
          type: 'ask',
          groupKey: low.groupKey,
          asOf: low.asOf,
          askMinor: low.askMinor,
          medianMinor: low.medianMinor,
          n: low.n,
          currency: low.currency,
          ratio: low.ratio,
        },
        evidenceText: null,
        ruleId: 'warning-signs.ask_far_below_similar',
      })
    }
    facts.push(...reasons)
  }

  return {
    listingId: input.listingId,
    evidenceHash: input.evidenceHash,
    cardHash: input.cardHash,
    inputHash: inputHash(input),
    ruleVersion: version,
    fetchedAt: input.fetchedAt,
    facts,
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The evaluations an event batch announces, as stored. */
export interface Announced {
  listingId: string
  evidenceHash: string
  inputHash: string
  ruleVersion: string
}

/**
 * The `warning-signs.found` key of one batch: the SHA-256 of its sorted
 * `listing@evidence@input@rule` lines plus the batch index, so a replay gives the same key and
 * any new input a new one.
 */
export function foundKey(rows: readonly Announced[], batch: number): string {
  const lines = rows
    .map((r) => `${r.listingId}@${r.evidenceHash}@${r.inputHash}@${r.ruleVersion}`)
    .sort()
  return `warning-signs.found:${sha256(lines.join('\n'))}:${batch}`
}
