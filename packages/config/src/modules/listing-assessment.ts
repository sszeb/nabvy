import { z } from 'zod'

// Thresholds and word lists of the listing-assessment module (rule 14 of
// docs/design/modules/_rules.md), validated with Zod like the env groups in ../env.ts. Every entry
// is a starting value until the module's fixtures calibrate it on more recorded runs; the basis
// is on each. Patterns are matched case-insensitively on word boundaries, after `+` between
// words is read as a space (the recorded run holds a `+`-encoded listing, dataset.json:3722). No
// prices here: the assessment prices nothing.

const words = z.array(z.string().min(1).max(60)).min(1)

const listingAssessmentConfig = z.object({
  eventBatchSize: z.int().min(1).max(500),
  ruleGeneration: z.int().min(1),
  contextChars: z.int().min(10).max(400),
  containerMinCoreParts: z.int().min(1).max(3),
  containerTitleWords: words,
  containerAttributeNames: words,
  gamingAttributeNames: words,
  extras: z.array(z.strictObject({ item: z.string().min(1).max(40), words })).min(1),
  extraDemoters: words,
  demoters: words,
  gpuNonePhrases: words,
  gpuIntegratedPhrases: words,
  boxOnlyPhrases: words,
  unknownPartTypes: z.array(z.enum(['gpu', 'cpu', 'ram_size', 'storage_size'])).min(1),
})

const config = listingAssessmentConfig.parse({
  /**
   * Listing IDs per handled batch and per `listing-assessment.assessed` event. Basis: rule 7 (at
   * most 500 listing IDs per event); CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
  /**
   * The generation in the rule version `a<n>.<digest>`; the digest covers every value below, so
   * any edit here gives a new version and a re-assessment. Status: bumped by hand on a code change.
   */
  ruleGeneration: 1,
  /**
   * R5: the clean context around a quote, in characters each side. Basis: "a clean context of
   * about 80 characters" (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:177-180), the same
   * window parts-rules reads. Status: starting value.
   */
  contextChars: 80,
  /**
   * R1: a listing is a container when its description, attributes or detail sections name at
   * least this many of CPU, RAM and storage (CONTAINER_LISTINGS.md:150-154). Status: the brief's
   * starting value.
   */
  containerMinCoreParts: 2,
  /** R1b: title words that make a container (CONTAINER_LISTINGS.md:155-159). Starting value. */
  containerTitleWords: ['package', 'bundle', 'setup', 'set up', 'job lot'],
  /**
   * R1b: seller-entered attribute names that make a container (CONTAINER_LISTINGS.md:155-159;
   * "Processor type" appears as a detail section in the recorded run, dataset.json:2116-2122).
   * Status: starting value.
   */
  containerAttributeNames: [
    'processor type',
    'form factor',
    'memory size',
    'ram size',
    'hard drive capacity',
    'storage capacity',
  ],
  /** R1b: "Is for gaming: Yes" counts (CONTAINER_LISTINGS.md:155-159). Starting value. */
  gamingAttributeNames: ['is for gaming'],
  /**
   * R1c: bundle extras, each with the words that name it (CONTAINER_LISTINGS.md:160-163). The
   * recorded run's bundles name a monitor, keyboard and mouse, desk and chair
   * (dataset.json:1775698700306989, 1639721697586478, 1352645884594841). Status: starting value.
   */
  extras: [
    { item: 'monitor', words: ['monitor', 'monitors'] },
    { item: 'keyboard', words: ['keyboard', 'kbm'] },
    { item: 'mouse', words: ['mouse', 'kbm'] },
    { item: 'mouse pad', words: ['mouse pad', 'mouse mat', 'mousepad', 'mousemat'] },
    { item: 'headset', words: ['headset', 'headphones'] },
    { item: 'speakers', words: ['speakers'] },
    { item: 'desk', words: ['desk'] },
    { item: 'chair', words: ['chair', 'gaming chair'] },
    { item: 'webcam', words: ['webcam'] },
    { item: 'microphone', words: ['microphone', 'mic'] },
  ],
  /**
   * R1c: words near an extra that make it not part of the sale (optional, extra cost, not
   * included). Checked in the extra's sentence, up to `contextChars` either side; a "no" or
   * "without" just before the extra demotes it too
   * (the recorded "This dose not include HDMi lead or keyboard or mouse", 1380502417485603;
   * "a 1080p monitor to sell with it if needed", 1756692548940192). Status: starting value.
   */
  extraDemoters: [
    'not include',
    'not included',
    'does not include',
    "doesn't include",
    'dose not include',
    'without',
    'excluding',
    'excludes',
    'if needed',
    'if wanted',
    'if required',
    'optional',
    'extra £',
    'for an extra',
    'for extra',
    'separately',
    'sold separately',
    'also selling',
    'to sell with',
    'can sell',
    'available for',
    'not for sale',
  ],
  /**
   * R5: words within `contextChars` of a quote that stop it being confirmed (a mention, an
   * upgrade, an alternative, a swap, a buy-in). Basis: CONTAINER_LISTINGS.md:177-180 and the
   * cases parts-rules demotes (its `PartsRulesInclusion` note). Status: starting value.
   */
  demoters: [
    'not included',
    'not include',
    'no longer',
    'upgraded to',
    'upgrade to',
    'waiting for',
    'equivalent',
    'similar to',
    'swap',
    'swaps',
    'trade for',
    'wanted',
    'looking for',
    'i buy',
    'we buy',
    'or similar',
    'can add',
    'can include',
    'option',
    'optional',
    'extra £',
    'removed',
    'faulty',
  ],
  /**
   * R6: phrases that are positive evidence of no GPU (CONTAINER_LISTINGS.md:183-185). Silence is
   * never a "no" (CONTAINER_LISTINGS.md:43-45). Status: starting value.
   */
  gpuNonePhrases: [
    'no gpu',
    'no graphics card',
    'no graphics',
    'without gpu',
    'without a gpu',
    'without graphics card',
    'without a graphics card',
    'gpu not included',
    'graphics card not included',
    'needs a gpu',
    'needs a graphics card',
    'no dedicated graphics',
  ],
  /** Phrases that state integrated graphics (CONTAINER_LISTINGS.md:143-144). Starting value. */
  gpuIntegratedPhrases: [
    'integrated graphics',
    'onboard graphics',
    'on-board graphics',
    'igpu',
    'intel uhd graphics',
    'intel hd graphics',
    'iris xe',
    'radeon vega graphics',
    'vega graphics',
  ],
  /** Box-only wording, a caution (the card; CONTAINER_LISTINGS.md). Starting value. */
  boxOnlyPhrases: ['box only', 'empty box', 'just the box', 'only the box', 'box and manuals only'],
  /**
   * The core parts `v_unknowns` lists for a container that does not state them, for "ask the
   * seller" (the card; fb-scrap-engine/docs/HANDOFF.md:168-170). Status: starting value.
   */
  unknownPartTypes: ['gpu', 'cpu', 'ram_size', 'storage_size'],
})

export type ListingAssessmentRules = Omit<typeof config, 'eventBatchSize'>

export const LISTING_ASSESSMENT_EVENT_BATCH_SIZE = config.eventBatchSize
export const LISTING_ASSESSMENT_RULES: ListingAssessmentRules = config
