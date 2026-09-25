import type { Account, AlertDelivery, Channel, DashboardSummary, Hunt, Preferences } from '../types'

/** The fixed "now" every fixture is written against, so screens and screenshots never drift. */
export const FIXTURE_AS_OF = '2026-09-24T13:30:00Z'

export const hunts: Hunt[] = [
  {
    id: 'h-1',
    name: 'RTX 30 and 40 series cards',
    terms: ['rtx 3070', 'rtx 3080', 'rtx 4070'],
    category: 'GPUs and gaming PCs',
    postcodeDistrict: 'PO19',
    radiusKm: 40,
    delivery: 'all',
    cadenceSeconds: 300,
    status: 'active',
    alertsThisWeek: 9,
    lastAlertAt: '2026-09-24T13:05:00Z',
    channels: ['telegram', 'push'],
  },
  {
    id: 'h-2',
    name: 'Gaming PCs under £700',
    terms: ['gaming pc'],
    category: 'GPUs and gaming PCs',
    postcodeDistrict: 'PO19',
    radiusKm: 40,
    maxAsk: { amountMinor: 70000, currency: 'GBP' },
    delivery: 'all',
    cadenceSeconds: 3600,
    status: 'active',
    alertsThisWeek: 5,
    lastAlertAt: '2026-09-24T12:44:00Z',
    channels: ['telegram'],
  },
  {
    id: 'h-3',
    name: 'AMD cards under £250',
    terms: ['rx 6700 xt', 'rx 6800'],
    category: 'GPUs and gaming PCs',
    maxAsk: { amountMinor: 25000, currency: 'GBP' },
    postcodeDistrict: 'PO19',
    radiusKm: 25,
    delivery: 'collection',
    cadenceSeconds: 14400,
    status: 'paused',
    alertsThisWeek: 1,
    lastAlertAt: '2026-09-23T19:16:00Z',
    channels: ['email'],
  },
]

export const channels: Channel[] = [
  { kind: 'telegram', status: 'linked', detail: 'Linked on 20 Sep' },
  {
    kind: 'push',
    status: 'needs_install',
    detail: 'On iPhone, add Nabvy to your Home Screen first',
  },
  { kind: 'email', status: 'linked', detail: 'Daily digest to your sign-in address' },
]

export const alertDeliveries: AlertDelivery[] = [
  {
    id: 'a-1',
    dealId: 'd-1001',
    listingTitle: 'MSI RTX 3070 Gaming X Trio 8GB',
    huntName: 'RTX 30 and 40 series cards',
    channel: 'telegram',
    status: 'delivered',
    at: '2026-09-24T13:05:00Z',
  },
  {
    id: 'a-2',
    dealId: 'd-1001',
    listingTitle: 'MSI RTX 3070 Gaming X Trio 8GB',
    huntName: 'RTX 30 and 40 series cards',
    channel: 'push',
    status: 'failed',
    at: '2026-09-24T13:05:00Z',
  },
  {
    id: 'a-3',
    dealId: 'd-1002',
    listingTitle: 'Gaming PC Ryzen 5 5600X, RTX 3060 Ti, 16GB, 1TB NVMe',
    huntName: 'Gaming PCs under £700',
    channel: 'telegram',
    status: 'delivered',
    at: '2026-09-24T12:44:00Z',
  },
  {
    id: 'a-4',
    dealId: 'd-1003',
    listingTitle: 'RTX 4070 Founders Edition',
    huntName: 'RTX 30 and 40 series cards',
    channel: 'telegram',
    status: 'delivered',
    at: '2026-09-24T12:02:00Z',
  },
  {
    id: 'a-5',
    dealId: 'd-1006',
    listingTitle: 'Sapphire Pulse RX 6700 XT 12GB',
    huntName: 'AMD cards under £250',
    channel: 'email',
    status: 'queued',
    at: '2026-09-23T19:16:00Z',
  },
]

export const account: Account = {
  email: 'alex@example.com',
  displayName: 'Alex',
  postcodeDistrict: 'PO19',
  signInMethods: ['magic_link', 'google'],
  createdAt: '2026-09-20T09:00:00Z',
}

export const preferences: Preferences = {
  marketing: [
    {
      id: 'daily',
      label: 'Nabvy Daily',
      description: 'A short morning email with deals near you and a market recap',
      enabled: true,
    },
    {
      id: 'product',
      label: 'Product news',
      description: 'New features and changes, about once a month',
      enabled: false,
    },
    {
      id: 'tips',
      label: 'Tips',
      description: 'How to get more from your hunts',
      enabled: false,
    },
  ],
  digestDay: 'monday',
}

export const dashboardSummary: DashboardSummary = {
  asOf: FIXTURE_AS_OF,
  alertsToday: 5,
  activeHunts: 2,
  medianListedToDeliveredMinutes: 3,
}
