import { z } from 'zod'

// Thresholds and word lists of the warning-signs module (rule 14 of docs/design/modules/_rules.md),
// validated with Zod like the env groups in ../env.ts. Every entry is a starting value until the
// module's fixtures calibrate it on more recorded runs; the basis is on each. Phrases are matched
// case-insensitively on word boundaries, inside one clause (text split at . ! ? ; , and line
// breaks), with any run of spaces, `+`, `-` or `/` between words, and with the digit-for-letter
// map of the too-good-to-be-true design (§2.2, L2 notes: 0→o, 1→i or l, 3→e, 5→s), so
// "p4y upfr0nt" style spellings match. "The design" below is docs/design/drafts/too-good-to-be-true.md.

const phrases = z.array(z.string().min(1).max(60)).min(1)

const FACT_CODES = [
  'pay_first_text',
  'platform_claim_text',
  'away_story_text',
  'off_platform_contact_text',
  'urgency_text',
  'thin_text',
  'viewing_offered_text',
  'payment_on_collection_text',
  'protected_payment_text',
  'box_only',
  'mining_text',
  'untested_text',
  'not_working_text',
  'stock_phrasing_text',
  'ask_far_below_similar',
  'low_ask_explained',
] as const

const warningSignsConfig = z.object({
  eventBatchSize: z.int().min(1).max(500),
  ruleGeneration: z.int().min(1),
  userFacingCodes: z.array(z.enum(FACT_CODES)).min(1),
  quoteMaxChars: z.int().min(20).max(200),
  negators: phrases,
  negationWindowWords: z.int().min(1).max(10),
  payNegationWindowWords: z.int().min(1).max(10),
  payFirst: z.object({
    friendsAndFamily: phrases,
    voucherGiftOrCrypto: phrases,
    deposit: phrases,
    bankTransfer: phrases,
    bankTransferClauseOnly: phrases,
    other: phrases,
    beforeCues: phrases,
    beforeCueExcept: phrases,
    exclusions: phrases,
  }),
  platformClaim: phrases,
  awayStory: phrases,
  contactApps: phrases,
  urgency: phrases,
  thinTextMaxChars: z.int().min(1).max(500),
  templateText: phrases,
  viewingOffered: phrases,
  paymentOnCollection: phrases,
  protectedPayment: phrases,
  mining: phrases,
  untested: phrases,
  notWorking: phrases,
  notWorkingExcept: phrases,
  forParts: phrases,
  stockPhrasing: phrases,
  namedFault: phrases,
  namedFaultExcept: phrases,
  corePartMissing: phrases,
  corePartTypes: phrases,
  swapOrTrade: phrases,
  offers: phrases,
  cosmetic: phrases,
  farBelowRatio: z.number().gt(0).lt(1),
  farBelowMinN: z.int().min(10),
  askExclusionsCompared: z.array(z.string().min(1)),
})

export type WarningSignsRules = z.infer<typeof warningSignsConfig>

const config = warningSignsConfig.parse({
  /** Listing IDs per handled batch and per event. Basis: rule 7 and rule 9. Fixed by the rule. */
  eventBatchSize: 500,
  /** Bumped by hand on a rule change the digest cannot see (code, not configuration). */
  ruleGeneration: 1,
  /**
   * Codes `app.v_warning_signs` shows (the migration's list must match; a test compares them).
   * Conservative until the owner approves wording (docs/questions/warning-signs.md): the card's
   * neutral wording facts and `pay_first_text` (catalogue question 18, answered "yes" by the
   * design pending wording). Price facts, `thin_text` and every too-good-to-be-true support or
   * counter signal stay internal; `stock_phrasing_text` is internal by the card.
   */
  userFacingCodes: [
    'pay_first_text',
    'box_only',
    'mining_text',
    'untested_text',
    'not_working_text',
  ],
  /** Longest stored quote (the clause around a match, redacted). Basis: rule 5, short quotes. */
  quoteMaxChars: 200,
  /** Words that negate a phrase when they come shortly before it in its clause. The design §2.2. */
  negators: [
    'no',
    'not',
    'never',
    "don't",
    'dont',
    'do not',
    "won't",
    'wont',
    "can't",
    'cant',
    'cannot',
    'unable',
    'without',
    'nor',
  ],
  /** Words before a phrase searched for a negator, for every rule but pay-first. Starting value. */
  negationWindowWords: 3,
  /** The same for pay-first and its exclusions. Basis: the design's `negationWindowWords` 5. */
  payNegationWindowWords: 5,
  payFirst: {
    /** Risky at any time (the design, L2). Basis: every UK authority's advice (§1.1). */
    friendsAndFamily: [
      'friends and family',
      'friends & family',
      'f&f',
      'fnf',
      'f n f',
      'ppff',
      'pp gift',
      'paypal gift',
      'paypal family',
      'gift payment',
    ],
    /** Risky at any time (the design, L2). */
    voucherGiftOrCrypto: [
      'gift card',
      'gift cards',
      'voucher',
      'vouchers',
      'steam card',
      'itunes card',
      'amazon card',
      'bitcoin',
      'btc',
      'crypto',
      'usdt',
      'ethereum',
    ],
    /** A deposit, holding fee or part-payment always counts (the design, L2 notes, Which? case). */
    deposit: ['deposit', 'deposits', 'holding fee', 'holding payment', 'part payment'],
    /** Counts only with a before-cue and no exclusion in the clause. Bare "bank transfer only" never. */
    bankTransfer: ['bank transfer', 'bacs', 'sort code', 'account number', 'faster payment'],
    /** Counts only in a clause that also names a payment word (BT is also the NI postcode area). */
    bankTransferClauseOnly: ['bt', 'b/t'],
    /** Any other payment word; needs a before-cue and no exclusion. */
    other: ['pay', 'payment', 'paid', 'paypal', 'money', 'transfer'],
    /** Before-cues (the design, L2). */
    beforeCues: [
      'before viewing',
      'before collection',
      'before posting',
      'before i post',
      'before sending',
      'before i send',
      'before dispatch',
      'before delivery',
      'upfront',
      'up front',
      'in advance',
      'to hold',
      'to secure',
      'to reserve',
      'prior to',
      'first',
    ],
    /** Blanked before the cues are read, so "first come first served" is no cue. Starting value. */
    beforeCueExcept: ['first come', 'first served', 'first to see', 'first to view', 'first time'],
    /** Tie the payment to the handover; exclude bank-transfer and other kinds (the design, L2 notes). */
    exclusions: [
      'on pickup',
      'on pick up',
      'on collection',
      'upon collection',
      'at collection',
      'when you collect',
      'when collecting',
      'on viewing',
      'in person',
      'on delivery',
      'when it arrives',
      'cash on',
    ],
  },
  /** L3. Plus any link whose host is not facebook.com, fb.com or fb.me. The design §2.2. */
  platformClaim: [
    'facebook delivery',
    'facebook shipping',
    'marketplace delivery',
    'marketplace shipping',
    'meta pay',
    'facebook pay',
    'facebook protection',
    'facebook purchase protection',
    'secure payment link',
    'payment link',
    'pay via link',
    'courier link',
    'delivery link',
  ],
  /** W1. Basis: TSB, Autotrader and the Met on the "cannot meet" story (the design §2.3). */
  awayStory: [
    'working away',
    'abroad',
    'offshore',
    'in the forces',
    'in the army',
    'deployed',
    "can't meet",
    'cannot meet',
    'unable to meet',
    'out of the country',
    'my brother has it',
    'my partner has it',
    'my son has it',
  ],
  /** W2, with quote-redaction's phone, email and link detectors. Row 18's "@ BACK PANEL" never matches. */
  contactApps: ['whatsapp', 'whats app', 'telegram', 'signal me', 'text me on', 'snapchat'],
  /** W4. 0 of 20 recorded rows (the design §2.3). */
  urgency: [
    'must go today',
    'must go asap',
    'need gone today',
    'needs to go today',
    'first to see will buy',
    'first to see it will buy',
    'lots of interest',
    'loads of interest',
    'pay to hold',
    'quick sale needed',
  ],
  /** W3. Basis: the shortest recorded genuine description is 56 characters (the design §2.3). */
  thinTextMaxChars: 40,
  /** Facebook's form leftovers removed before the length is read (row 1, dataset.json:139). */
  templateText: ['(Specify if you are willing to deliver locally)'],
  /** X1. Fires on rows 3, 4 and 7 of the recorded run (the design §2.3). */
  viewingOffered: [
    'welcome to test',
    'welcome to view',
    'viewing welcome',
    'viewings welcome',
    'tests welcome',
    'testing welcome',
    'can see it running',
    'see it running',
    'see it working',
    'happy to power it on',
    'happy to show it working',
    'come and test',
    'arrange a viewing',
    'arrange a test',
    'test before buying',
    'demo on collection',
  ],
  /** X1. Not fired on a clause that also demands a deposit. Rows 1 and 14 (the design §2.3). */
  paymentOnCollection: [
    'cash on collection',
    'cash on pickup',
    'cash on pick up',
    'cash in person',
    'bank transfer on pickup',
    'bank transfer on collection',
    'pay on collection',
    'payment on collection',
    'pay on pickup',
    'payment on pickup',
    'pay when you collect',
    'payment when you collect',
  ],
  /** X2. Bare "card" never matches: "graphics card" is everywhere (the design §2.3). */
  protectedPayment: [
    'paypal goods and services',
    'paypal goods & services',
    'paypal g&s',
    'goods and services',
    'pay by card',
    'card payment',
    'card payments',
    'pay on delivery',
    'pay when it arrives',
    'via ebay',
  ],
  /** Basis: docs/packs/gpu-pc.md:40; "rig" alone is left out ("gaming rig"). Starting value. */
  mining: ['mining', 'mined', 'hashrate', 'hash rate', 'lhr unlocked'],
  /** Basis: docs/packs/gpu-pc.md:41. Row 4 "Sold as seen" (the design §2.4). */
  untested: [
    'untested',
    'not tested',
    'no way to test',
    'unable to test',
    "can't test",
    'cannot test',
    'sold as seen',
  ],
  /** Basis: docs/packs/gpu-pc.md:47, a real offer and not noise. */
  notWorking: ['not working', "doesn't work", 'doesnt work', 'does not work', 'non working'],
  /** Returns-policy wording, not this item's state (dataset.json:3722). Blanked first. */
  notWorkingExcept: [
    "if something doesn't work",
    'if something doesnt work',
    "if it doesn't work",
    'if it doesnt work',
    'if not working',
  ],
  /** Basis: docs/packs/gpu-pc.md:47. */
  forParts: [
    'for parts',
    'parts only',
    'spares only',
    'for spares',
    'spares or repair',
    'spares or repairs',
    'spares and repair',
    'spares and repairs',
    'spares & repairs',
  ],
  /** Trade stock phrasing. Basis: "7-day return/warranty on all purchases" (dataset.json:3722). */
  stockPhrasing: [
    'day return',
    'day returns',
    'day warranty',
    'warranty on all',
    'on all purchases',
    'all items tested',
    'we buy',
    'we also buy',
    'happy buyers',
  ],
  /** Named faults: a low ask's material-state reason. Basis: SELLER_DATA.md:85-87 (faults). */
  namedFault: [
    'faulty',
    'fault',
    'artifacts',
    'artifacting',
    'artefacts',
    'no display',
    'no signal',
    "won't boot",
    'wont boot',
    "won't turn on",
    'wont turn on',
    'no power',
    'blue screen',
    'bsod',
    'crashes',
    'overheats',
    'overheating',
    'needs repair',
    'broken',
    'cracked',
  ],
  /** Trader boilerplate, not a fault of this item (dataset.json:3722). Blanked first. */
  namedFaultExcept: ['working or faulty', 'faulty or working', 'working or not'],
  /** A named core part missing, from the text; listing-assessment's exclusions add more. */
  corePartMissing: [
    'no gpu',
    'without gpu',
    'no graphics card',
    'without graphics card',
    'without a graphics card',
    'gpu removed',
    'gpu not included',
    'graphics card not included',
    'no cpu',
    'no processor',
    'no ram',
    'no ssd',
    'no hard drive',
    'no storage',
    'no psu',
    'no power supply',
  ],
  /** Part types whose exclusion (listing-assessment `exclusions`, no part row) is a core part missing. */
  corePartTypes: ['gpu', 'cpu', 'ram', 'storage', 'psu', 'motherboard'],
  /** Recorded, never honoured (the design, P notes). 2 of 20 recorded rows mention swaps. */
  swapOrTrade: ['swap', 'swaps', 'trade', 'trades', 'part exchange', 'px'],
  /** Recorded, never honoured. */
  offers: ['offers', 'ono', 'ovno', 'open to offers', 'nearest offer', 'best offer'],
  /** Recorded, never honoured. */
  cosmetic: [
    'scratch',
    'scratches',
    'scuff',
    'scuffs',
    'scuffed',
    'marks',
    'dent',
    'dents',
    'cosmetic',
    'coil whine',
    'dust',
    'dusty',
  ],
  /**
   * An ask at or below this share of its group's median is "far below". Basis: the brief's
   * analysis cut, where wording explained 27% of 48 asks below 0.6× (SELLER_DATA.md:85-87).
   * Starting value; shadow tests 0.7 and 0.8 too.
   */
  farBelowRatio: 0.6,
  /** Groups with fewer counted asks are never compared. Basis: docs/decisions.md:15 (n≥10). */
  farBelowMinN: 10,
  /**
   * asking-price-index exclusions that still compare: an outlier cut is exactly the cheap ask
   * this rule looks for. Every other exclusion (noise, sold, suppressed…) is not compared.
   */
  askExclusionsCompared: ['outlier'],
})

export const WARNING_SIGNS_RULES: WarningSignsRules = config
export const WARNING_SIGNS_EVENT_BATCH_SIZE = config.eventBatchSize
