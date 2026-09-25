import {
  CopyAdvertRuleConfig,
  type CopyAdvertRuleVersion,
} from '@nabvy/contracts/modules/copy-advert'

// Thresholds live here, not in packages/config: they are part of the rule version, so changing a
// value bumps RULE_VERSION (docs/design/drafts/copy-advert.md section 0, change 1 — a departure
// from rule 14 of docs/design/modules/_rules.md that the coordinator confirmed).

export const RULE_VERSION: CopyAdvertRuleVersion = 'copy-advert@1'

/** Thresholds of rule version copy-advert@1 (docs/design/drafts/copy-advert.md 4.12). */
export const RULES: CopyAdvertRuleConfig = CopyAdvertRuleConfig.parse({
  /** "Long" titles were not measured; generic recorded titles are 9-17 characters. Starting value. */
  titleMinChars: 20,
  /** The recorded range is 55-1,057 normalised characters, median 309. Starting value. */
  descMinChars: 100,
  /** The highest similarity between two different recorded listings is 0.374. Starting value. */
  nearText: 0.8,
  /** Stricter than nearText because title or price disagree; no in-scope measurement. Starting value. */
  textCopy: 0.9,
  textCopyMinChars: 200,
  /** The asking-price index's window. Starting value. */
  windowDays: 30,
  /** The brief's measurement definition of a mass-posted advert. */
  massPostedMinTowns: 2,
  /** Owner decision pending (docs/questions/copy-advert.md, question 3); proposal of 5 meanwhile. */
  flagMinTowns: 5,
  /** At most ~200 IDs per details batch; well within the $150/month Apify cap. Starting value. */
  candidateDailyCap: 200,
})
