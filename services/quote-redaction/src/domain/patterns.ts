import type { QuoteRedactionKind } from '@nabvy/contracts/modules/quote-redaction'

// The detectors, in the order they run. The same pattern sources, flags and masks are written in
// the SQL function quote_redaction.redact_result (packages/db/migrations/quote-redaction/); a test
// checks that the migration carries every source verbatim, and both run the same cases
// (test/cases.json). So each source uses only syntax that JavaScript and PostgreSQL's advanced
// regular expressions read the same way: no \b (a backspace in PostgreSQL), explicit lookarounds
// for boundaries, and only greedy quantifiers, so PostgreSQL's longest match and JavaScript's
// backtracking pick the same span.

export type Detector = {
  kind: QuoteRedactionKind
  /** Pattern source, shared with SQL. */
  source: string
  /** 'g' or 'gi'; the same flags are passed to regexp_replace and regexp_count. */
  flags: 'g' | 'gi'
  /** Replacement; `$1`/`$2` refer to kept groups (written `\1`/`\2` in SQL). */
  mask: string
}

/** Characters that may not sit directly before or after a match. */
const notWord = '[A-Za-z0-9_]'
const notEmailChar = '[A-Za-z0-9._%+-]'
/** Trailing punctuation is left outside a link, so a sentence keeps its full stop. */
const linkTail = '[^\\s<>"]*[^\\s<>".,;:!?)\\]]'
const tlds = [
  'com',
  'co\\.uk',
  'org\\.uk',
  'uk',
  'net',
  'org',
  'io',
  'me',
  'shop',
  'store',
  'biz',
  'info',
]

/** UK postcode areas (the letters before the first digit), longest first. */
export const postcodeAreas = [
  'AB',
  'AL',
  'BA',
  'BB',
  'BD',
  'BF',
  'BH',
  'BL',
  'BN',
  'BR',
  'BS',
  'BT',
  'BX',
  'CA',
  'CB',
  'CF',
  'CH',
  'CM',
  'CO',
  'CR',
  'CT',
  'CV',
  'CW',
  'DA',
  'DD',
  'DE',
  'DG',
  'DH',
  'DL',
  'DN',
  'DT',
  'DY',
  'EC',
  'EH',
  'EN',
  'EX',
  'FK',
  'FY',
  'GL',
  'GU',
  'GY',
  'HA',
  'HD',
  'HG',
  'HP',
  'HR',
  'HS',
  'HU',
  'HX',
  'IG',
  'IM',
  'IP',
  'IV',
  'JE',
  'KA',
  'KT',
  'KW',
  'KY',
  'LA',
  'LD',
  'LE',
  'LL',
  'LN',
  'LS',
  'LU',
  'ME',
  'MK',
  'ML',
  'NE',
  'NG',
  'NN',
  'NP',
  'NR',
  'NW',
  'OL',
  'OX',
  'PA',
  'PE',
  'PH',
  'PL',
  'PO',
  'PR',
  'RG',
  'RH',
  'RM',
  'SA',
  'SE',
  'SG',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SP',
  'SR',
  'SS',
  'ST',
  'SW',
  'SY',
  'TA',
  'TD',
  'TF',
  'TN',
  'TQ',
  'TR',
  'TS',
  'TW',
  'UB',
  'WA',
  'WC',
  'WD',
  'WF',
  'WN',
  'WR',
  'WS',
  'WV',
  'YO',
  'ZE',
  'B',
  'E',
  'G',
  'L',
  'M',
  'N',
  'S',
  'W',
]

export const detectors: readonly Detector[] = [
  {
    kind: 'email',
    source: `(?<!${notEmailChar})[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}(?![A-Za-z0-9-])`,
    flags: 'gi',
    mask: '[email redacted]',
  },
  {
    kind: 'link',
    source: `(?:https?://|www\\.)${linkTail}`,
    flags: 'gi',
    mask: '[link redacted]',
  },
  {
    // Bare domains such as wa.me/447…, instagram.com/name or shop.co.uk.
    kind: 'link',
    source: `(?<![A-Za-z0-9._@-])[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9-]+)*\\.(?:${tlds.join('|')})(?![A-Za-z0-9-])(?:/${linkTail})?`,
    flags: 'gi',
    mask: '[link redacted]',
  },
  {
    kind: 'handle',
    source: `(?<!${notEmailChar})@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?`,
    flags: 'gi',
    mask: '[handle redacted]',
  },
  {
    // "insta: name", "snapchat : name": the label stays, the name goes.
    kind: 'handle',
    source: `(?<![A-Za-z0-9])((?:insta(?:gram)?|snap(?:chat)?|tiktok|telegram)\\s*:\\s*)[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?`,
    flags: 'gi',
    mask: '$1[handle redacted]',
  },
  {
    // UK numbers: 0 or +44 / 0044 (optionally "(0)"), then 7 to 13 more digits with single
    // spaces, dots or dashes between them; wider than the numbering plan on purpose.
    kind: 'phone',
    source: `(?<![A-Za-z0-9+])(?:(?:\\+|00)44[\\s.-]?(?:\\(0\\)[\\s.-]?)?|\\(?0)[1-9][0-9]{1,4}\\)?(?:[\\s.-]?[0-9]){5,8}(?![0-9])`,
    flags: 'g',
    mask: '[phone redacted]',
  },
  {
    // Full postcodes: the outward code (area, district) stays, the inward half goes. Any case:
    // only real postcode areas start one, so model names such as "i7 9th" are left alone.
    kind: 'postcode',
    source: `(?<!${notWord})(${postcodeAreas.join('|')})([0-9][0-9A-Z]?)\\s?[0-9][ABD-HJLNP-UW-Z]{2}(?!${notWord})`,
    flags: 'gi',
    mask: '$1$2 [redacted]',
  },
]
