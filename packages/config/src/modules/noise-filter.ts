import { z } from 'zod'

// Thresholds and word lists of the noise-filter module (rule 14 of docs/design/modules/_rules.md),
// validated with Zod like the env groups in ../env.ts. Every entry is a starting value until the
// module's fixtures calibrate it on more recorded runs; the basis is on each. Phrases are matched
// case-insensitively on word boundaries, with any run of spaces, `+`, `-` or `/` between words
// (the recorded run holds a `+`-encoded title, dataset.json:3722). No prices here: the filter
// prices nothing.

const phrases = z.array(z.string().min(1).max(60)).min(1)

const noiseFilterConfig = z.object({
  eventBatchSize: z.int().min(1).max(500),
  ruleGeneration: z.int().min(1),
  wantedTitle: phrases,
  buyInTitle: phrases,
  buyInTitleStart: phrases,
  buyInDescription: phrases,
  swapTitle: phrases,
  swapSaleCues: phrases,
  negators: phrases,
  negatorChars: z.int().min(1).max(40),
  descriptionFirstChars: z.int().min(50).max(2000),
  serviceTitle: phrases,
  serviceDescription: z.array(z.string().min(1).max(200)).min(1),
  serviceTitleExcept: phrases,
  termModelPattern: z.string().min(1).max(200),
})

export type NoiseFilterRules = z.infer<typeof noiseFilterConfig>

const config = noiseFilterConfig.parse({
  /**
   * Listing IDs per handled batch and per `noise-filter.classified` event. Basis: rule 7 (at most
   * 500 listing IDs per event); CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
  /**
   * The generation in the rule version `n<n>.<digest>`; the digest covers every value below, so
   * any edit here gives a new version and a re-classification. Status: bumped by hand on a code
   * change.
   */
  ruleGeneration: 1,
  /**
   * Title words of a wanted advert, read only where parts-rules recorded a `wanted_or_swap` title
   * signal (the actor's `wantedTitle`, fb-scrap-engine/docs/data/part-patterns.json:5). Basis: the
   * narrow wanted pattern of docs/questions.md (2026-09-24, 0.4); the broader words (need a, want,
   * lf, iso, trade, px, exchange, £££) stay out until fixtures measure them. Status: starting value.
   */
  wantedTitle: ['wanted', 'wtb', 'want to buy', 'looking for', 'l/f'],
  /** Title phrases of a buy-in advert, anywhere in the title. Basis and status: as above. */
  buyInTitle: [
    'i buy',
    'we buy',
    "i'm buying",
    'im buying',
    'buyer of',
    'buying your',
    'buying all',
    'buying any',
    'buying broken',
    'buy your',
    'buy all',
    'buy any',
    'buy broken',
    'cash for your',
    'cash paid for',
    'sell me your',
    'sell your',
  ],
  /** Title words of a buy-in advert only when they open the title ("Buying gaming PCs"). */
  buyInTitleStart: ['buying', 'cash for', 'cash paid'],
  /**
   * Description phrases of a buy-in advert, read only where parts-rules recorded a description
   * `wanted_or_swap` signal (the actor's `wantedDescriptionFirst400Chars`, part-patterns.json:6),
   * only in the description's first sentence, and only when the title offers no part. Trader
   * boilerplate further on ("We buy and part-exchange", dataset.json:3648) is not the listing's
   * own offer. Status: starting value; the recorded run's one trader sale is the negative case.
   */
  buyInDescription: [
    'i buy',
    'we buy',
    'i am buying',
    'we are buying',
    "i'm buying",
    "we're buying",
    'cash for',
    'cash paid for',
    'sell me your',
    'looking to buy',
    'pay top',
    'pay good',
    'pay cash',
    'wanted',
  ],
  /**
   * Title words of a swap advert, read only where parts-rules recorded a title `wanted_or_swap`
   * signal. A swap counts only when the word opens the title or is followed by "for" ("Swap PS5
   * for gaming PC"); a sale that welcomes swaps is not a swap advert (the card). Status: starting
   * value; the recorded run holds no swap advert.
   */
  swapTitle: ['swap', 'swaps', 'swapping', 'swop'],
  /** Title words that make a swap word part of a sale ("or swap", "swaps considered"). */
  swapSaleCues: [
    'or',
    'sale',
    'sell',
    'selling',
    'welcome',
    'considered',
    'consider',
    'accepted',
    'open to',
    'ono',
    'possible',
    'poss',
  ],
  /** A signal right after one of these words is negated ("No swaps", "not looking for"). */
  negators: ['no', 'not', 'non', "don't", 'dont', 'without', 'never'],
  /** How far before a signal a negator is looked for. Basis: "no time wasters, no swaps". */
  negatorChars: 12,
  /**
   * Leading description characters the buy-in and service rules read. Basis: the pattern's name,
   * `wantedDescriptionFirst400Chars` (part-patterns.json:6). Status: starting value.
   */
  descriptionFirstChars: 400,
  /**
   * Title phrases of a service or repair advert. Basis: "Gaming pc / Builder and repair"
   * (dataset.json:6713). Status: starting value; one recorded service advert.
   */
  serviceTitle: [
    'builder',
    'builders',
    'service',
    'services',
    'repair service',
    'repair shop',
    'and repair',
    'and repairs',
    '& repair',
    '& repairs',
    'repairs and',
    'pc repair',
    'pc repairs',
    'computer repair',
    'computer repairs',
  ],
  /**
   * Title phrases blanked before `serviceTitle` is read: faulty items for sale, not services.
   * Status: starting value.
   */
  serviceTitleExcept: [
    'spares or repair',
    'spares or repairs',
    'spares and repair',
    'spares and repairs',
    'spares & repair',
    'spares & repairs',
    'spares/repair',
    'spares/repairs',
    'for repair',
    'needs repair',
    'need repair',
  ],
  /**
   * Regular expressions (case-insensitive) of a service offer in the description's first
   * characters; counted only when the listing offers no part. Basis: "I provide reliable and
   * affordable PC services" (dataset.json:6714). Status: starting value.
   */
  serviceDescription: [
    '\\b(i|we)\\s+(offer|provide|do)\\s+(\\S+\\s+){0,4}?(services?|repairs?|builds?|upgrades?)\\b',
    '\\b(i|we)\\s+(can\\s+)?(build|repair|fix|upgrade)\\s+(your|any|custom)\\b',
    '\\bpc\\s+(building|build|repair)\\s+services?\\b',
  ],
  /**
   * The model number a search term names: 3 to 5 digits (a maker's prefix may be attached, as in
   * "rtx5080") with an optional GPU suffix, as
   * parts-rules' `gpuKey` reads one (services/parts-rules/src/domain/rules.ts). A term without
   * one ("gaming pc") is generic and never makes a listing mention-only. Status: starting value.
   */
  termModelPattern: '(?<!\\p{N})(\\d{3,5})\\s*-?\\s*(ti|super|xtx|xt|gre)?(?![\\p{L}\\p{N}])',
})

export const NOISE_FILTER_RULES: NoiseFilterRules = config
export const NOISE_FILTER_EVENT_BATCH_SIZE = config.eventBatchSize
