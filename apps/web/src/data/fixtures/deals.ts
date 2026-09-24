import type { Deal, ListingFact } from '../types'

/**
 * Invented design fixtures, not real listings: titles, prices and towns are made up to exercise
 * every state the screens have. No seller data exists here by construction.
 */

const facts = (entries: Array<[label: string, value: string | undefined]>): ListingFact[] =>
  entries.map(([label, value]) =>
    value === undefined ? { label, status: 'not_stated' } : { label, value, status: 'stated' },
  )

/** Clearly invalid placeholder links, so no fixture can resolve to a real listing. */
const item = (id: string) => `https://marketplace.example.invalid/item/${id}/`

const standardChecklist = [
  'Ask for a photo of the card running a benchmark, with today’s date on paper',
  'Check the fans spin and the ports are undamaged',
  'Meet somewhere public, and test before paying',
  'Pay by a method that leaves a record',
]

export const deals: Deal[] = [
  {
    id: 'd-1001',
    huntId: 'h-1',
    huntName: 'RTX 30 and 40 series cards',
    matchReason: 'Matches “RTX 3070” within 40 km of PO19',
    listing: {
      id: '9000000000000101',
      source: 'facebook',
      title: 'MSI RTX 3070 Gaming X Trio 8GB',
      ask: { amountMinor: 21000, currency: 'GBP' },
      town: 'Chichester',
      distanceKm: 2,
      delivery: 'collection',
      condition: 'Used, good',
      keyFacts: facts([
        ['GPU', 'RTX 3070 8GB'],
        ['Box', 'Original box'],
        ['Mining use', undefined],
        ['Receipt', undefined],
      ]),
      photoCount: 4,
      freshness: {
        listedAt: '2026-09-24T13:02:00Z',
        foundAt: '2026-09-24T13:05:00Z',
        deliveredAt: '2026-09-24T13:05:00Z',
      },
      listingUrl: item('9000000000000101'),
    },
    position: {
      askMinor: 21000,
      currency: 'GBP',
      comparableCount: 23,
      comparableLabel: 'used RTX 3070 cards, UK, last 30 days',
      percentile: 13,
      range: {
        lowestMinor: 18000,
        lowerQuartileMinor: 22500,
        medianMinor: 25000,
        upperQuartileMinor: 27500,
        highestMinor: 32000,
      },
      windowDays: 30,
    },
    suspicions: [],
    warnings: [{ id: 'w-1', text: 'Collection only' }],
    priceChanges: [],
    preparedMessage:
      'Hello, is the RTX 3070 still available? Could you tell me whether it has been used for mining and whether you still have the receipt? I can collect this week.',
    checklist: standardChecklist,
  },
  {
    id: 'd-1002',
    huntId: 'h-2',
    huntName: 'Gaming PCs under £700',
    matchReason: 'Matches “gaming pc” under £700 within 40 km of PO19',
    listing: {
      id: '9000000000000102',
      source: 'facebook',
      title: 'Gaming PC Ryzen 5 5600X, RTX 3060 Ti, 16GB, 1TB NVMe',
      ask: { amountMinor: 55000, currency: 'GBP' },
      town: 'Bognor Regis',
      distanceKm: 10,
      delivery: 'both',
      condition: 'Used, like new',
      keyFacts: facts([
        ['CPU', 'Ryzen 5 5600X'],
        ['GPU', 'RTX 3060 Ti'],
        ['RAM', '16GB DDR4'],
        ['Storage', '1TB NVMe'],
        ['PSU', undefined],
      ]),
      photoCount: 6,
      freshness: {
        listedAt: '2026-09-24T12:41:00Z',
        foundAt: '2026-09-24T12:44:00Z',
        deliveredAt: '2026-09-24T12:44:00Z',
      },
      listingUrl: item('9000000000000102'),
    },
    position: {
      askMinor: 55000,
      currency: 'GBP',
      comparableCount: 14,
      comparableLabel: 'used gaming PCs with an RTX 3060 Ti and a Ryzen 5 5600X, UK, last 30 days',
      percentile: 36,
      range: {
        lowestMinor: 45000,
        lowerQuartileMinor: 52000,
        medianMinor: 58000,
        upperQuartileMinor: 64000,
        highestMinor: 75000,
      },
      windowDays: 30,
    },
    suspicions: [
      {
        id: 's-1',
        kind: 'trade_seller',
        facts: 'the description offers a warranty and says more units are available',
        evidence: [
          { label: 'Description', detail: '“3 month warranty included”' },
          { label: 'Description', detail: '“More builds available, message for specs”' },
        ],
        rule: 'Trade wording in the listing text (rule TS-1)',
      },
    ],
    warnings: [{ id: 'w-2', text: 'The PSU model is not stated' }],
    priceChanges: [],
    preparedMessage:
      'Hello, is the gaming PC still available? Which power supply does it use, and could I see it running a game before buying?',
    checklist: [
      'Ask for the PSU make and model',
      'See it boot and run a game for a few minutes',
      'Check the warranty terms in writing',
      'Pay by a method that leaves a record',
    ],
  },
  {
    id: 'd-1003',
    huntId: 'h-1',
    huntName: 'RTX 30 and 40 series cards',
    matchReason: 'Matches “RTX 4070” within 40 km of PO19',
    listing: {
      id: '9000000000000103',
      source: 'facebook',
      title: 'RTX 4070 Founders Edition',
      ask: { amountMinor: 38000, currency: 'GBP' },
      town: 'Havant',
      distanceKm: 15,
      delivery: 'collection',
      condition: 'Used, good',
      keyFacts: facts([
        ['GPU', 'RTX 4070 12GB'],
        ['Box', undefined],
        ['Receipt', 'Receipt available'],
      ]),
      photoCount: 3,
      freshness: {
        listedAt: '2026-09-24T11:58:00Z',
        foundAt: '2026-09-24T12:01:00Z',
        deliveredAt: '2026-09-24T12:02:00Z',
      },
      listingUrl: item('9000000000000103'),
    },
    position: {
      askMinor: 38000,
      currency: 'GBP',
      comparableCount: 7,
      comparableLabel: 'used RTX 4070 Founders Edition cards, UK, last 30 days',
      percentile: 20,
      range: {
        lowestMinor: 36000,
        lowerQuartileMinor: 39000,
        medianMinor: 42000,
        upperQuartileMinor: 44000,
        highestMinor: 47000,
      },
      windowDays: 30,
    },
    suspicions: [],
    warnings: [],
    priceChanges: [],
    preparedMessage:
      'Hello, is the RTX 4070 still available? Could you send a photo of the receipt with the date visible?',
    checklist: standardChecklist,
  },
  {
    id: 'd-1004',
    huntId: 'h-2',
    huntName: 'Gaming PCs under £700',
    matchReason: 'Matches “gaming pc” under £700 within 40 km of PO19',
    listing: {
      id: '9000000000000104',
      source: 'facebook',
      title: 'Gaming PC i5 12400F RTX 3070 32GB RAM',
      ask: { amountMinor: 62000, currency: 'GBP' },
      town: 'Portsmouth',
      distanceKm: 24,
      delivery: 'collection',
      condition: 'Used, good',
      keyFacts: facts([
        ['CPU', 'Intel i5 12400F'],
        ['GPU', 'RTX 3070'],
        ['RAM', '32GB DDR4'],
        ['Storage', undefined],
      ]),
      photoCount: 5,
      freshness: {
        listedAt: '2026-09-24T10:17:00Z',
        foundAt: '2026-09-24T10:20:00Z',
        deliveredAt: '2026-09-24T10:21:00Z',
      },
      listingUrl: item('9000000000000104'),
    },
    position: {
      askMinor: 62000,
      currency: 'GBP',
      comparableCount: 11,
      comparableLabel: 'used gaming PCs with an RTX 3070 and a 12th-gen i5, UK, last 30 days',
      percentile: 55,
      range: {
        lowestMinor: 50000,
        lowerQuartileMinor: 57000,
        medianMinor: 61000,
        upperQuartileMinor: 66000,
        highestMinor: 80000,
      },
      windowDays: 30,
    },
    suspicions: [
      {
        id: 's-2',
        kind: 'copy_advert',
        facts: 'the advert text matches 6 other listings posted this week',
        evidence: [
          {
            label: 'Matching text',
            detail: '6 listings in the last 7 days share 94% of this text',
          },
        ],
        rule: 'Copy-advert text similarity (rule CA-1)',
      },
    ],
    warnings: [{ id: 'w-3', text: 'Storage is not stated' }],
    priceChanges: [],
    preparedMessage:
      'Hello, is the PC still available? Could you tell me what storage it has and send a photo of it running?',
    checklist: [
      'Ask what storage is fitted',
      'See it boot and run a game for a few minutes',
      'Meet somewhere public, and test before paying',
    ],
  },
  {
    id: 'd-1005',
    huntId: 'h-1',
    huntName: 'RTX 30 and 40 series cards',
    matchReason: 'Matches “RTX 3080” within 40 km of PO19',
    listing: {
      id: '9000000000000105',
      source: 'facebook',
      title: 'EVGA RTX 3080 FTW3 10GB',
      ask: { amountMinor: 34000, currency: 'GBP' },
      town: 'Worthing',
      distanceKm: 28,
      delivery: 'both',
      keyFacts: facts([
        ['GPU', 'RTX 3080 10GB'],
        ['Box', 'Original box'],
        ['Mining use', 'Stated: not used for mining'],
      ]),
      photoCount: 2,
      freshness: {
        listedAt: '2026-09-24T08:44:00Z',
        foundAt: '2026-09-24T08:47:00Z',
        deliveredAt: '2026-09-24T08:47:00Z',
      },
      listingUrl: item('9000000000000105'),
    },
    position: {
      askMinor: 34000,
      currency: 'GBP',
      comparableCount: 18,
      comparableLabel: 'used RTX 3080 10GB cards, UK, last 30 days',
      percentile: 78,
      range: {
        lowestMinor: 26000,
        lowerQuartileMinor: 28500,
        medianMinor: 31000,
        upperQuartileMinor: 33500,
        highestMinor: 38000,
      },
      windowDays: 30,
    },
    suspicions: [],
    warnings: [{ id: 'w-4', text: 'Condition is not stated' }],
    priceChanges: [
      { at: '2026-09-24T08:44:00Z', ask: { amountMinor: 36000, currency: 'GBP' } },
      { at: '2026-09-24T11:30:00Z', ask: { amountMinor: 34000, currency: 'GBP' } },
    ],
    preparedMessage:
      'Hello, is the RTX 3080 still available? What condition would you say it is in?',
    checklist: standardChecklist,
  },
  {
    id: 'd-1006',
    huntId: 'h-3',
    huntName: 'AMD cards under £250',
    matchReason: 'Matches “rx 6700 xt” under £250 within 25 km of PO19',
    listing: {
      id: '9000000000000106',
      source: 'facebook',
      title: 'Sapphire Pulse RX 6700 XT 12GB',
      ask: { amountMinor: 19500, currency: 'GBP' },
      town: 'Petersfield',
      distanceKm: 22,
      delivery: 'collection',
      condition: 'Used, like new',
      keyFacts: facts([
        ['GPU', 'RX 6700 XT 12GB'],
        ['Box', 'Original box'],
        ['Mining use', undefined],
      ]),
      photoCount: 3,
      freshness: {
        listedAt: '2026-09-23T19:12:00Z',
        foundAt: '2026-09-23T19:16:00Z',
        deliveredAt: '2026-09-23T19:16:00Z',
      },
      listingUrl: item('9000000000000106'),
    },
    position: {
      askMinor: 19500,
      currency: 'GBP',
      comparableCount: 31,
      comparableLabel: 'used RX 6700 XT 12GB cards, UK, last 30 days',
      percentile: 42,
      range: {
        lowestMinor: 16000,
        lowerQuartileMinor: 18500,
        medianMinor: 20000,
        upperQuartileMinor: 22000,
        highestMinor: 26000,
      },
      windowDays: 30,
    },
    suspicions: [],
    warnings: [],
    priceChanges: [],
    preparedMessage: 'Hello, is the RX 6700 XT still available? Has it been used for mining?',
    checklist: standardChecklist,
  },
]

/** A Dublin listing: an EUR ask, compared only with other EUR asks. Used on the /design page. */
export const irishDeal: Deal = {
  ...(deals[0] as Deal),
  id: 'd-2001',
  huntName: 'RTX cards, Dublin',
  matchReason: 'Matches “RTX 3070” within 40 km of Dublin 8',
  listing: {
    ...(deals[0] as Deal).listing,
    id: '9000000000000201',
    title: 'Gigabyte RTX 3070 Eagle OC',
    ask: { amountMinor: 26000, currency: 'EUR' },
    town: 'Dublin',
    distanceKm: 4,
    listingUrl: item('9000000000000201'),
  },
  position: {
    askMinor: 26000,
    currency: 'EUR',
    comparableCount: 6,
    comparableLabel: 'used RTX 3070 cards, Ireland, last 30 days',
    percentile: 30,
    range: {
      lowestMinor: 22000,
      lowerQuartileMinor: 25000,
      medianMinor: 28000,
      upperQuartileMinor: 30000,
      highestMinor: 34000,
    },
    windowDays: 30,
  },
  priceChanges: [],
}
