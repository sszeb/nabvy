/**
 * The web app's data-access layer. Screens call only these functions. Today they return typed
 * fixtures; each one is replaced by a call to the matching oRPC procedure (task 4.1) with the
 * same signature, so no screen changes when real data arrives (apps/web/README.md).
 *
 * Every function is async on purpose, so screens already await them the way they will await
 * procedures.
 *
 * Server only (task 4.3af, audit A11): screens are server components, and nothing here may reach a
 * client bundle. The admin reads refuse under a production build (`refuseAdminFixturesInProduction`).
 */
import 'server-only'

import { loadEnv } from '@nabvy/config'
import type { WantManagerWant } from '@nabvy/contracts/modules/want-manager'
import { call } from '@orpc/server'
import { requireUser } from '@/lib/session'
import { rpcCallOptions } from '@/rpc/call'
import type { FeedItem } from '@/rpc/procedures/feed'
import { router } from '@/rpc/router'
import { alertDeliveries, channels, dashboardSummary, preferences } from './fixtures/account'
import { adminOverview, reviewQueue } from './fixtures/admin'
import { deals as exampleDeals, irishDeal } from './fixtures/deals'
import type {
  Account,
  AdminOverview,
  AlertDelivery,
  Channel,
  DashboardSummary,
  Deal,
  Hunt,
  ListingSummary,
  Preferences,
  ReviewItem,
} from './types'

export type DealQuery = {
  /** Free text matched against the title. There is no per-want matching yet (no `spec-match`
   * module merged), so this is the only filter task L1 can honestly offer — see
   * docs/questions/L1-web.md. */
  q?: string
}

export async function getAsOf(): Promise<string> {
  return new Date().toISOString()
}

function listingFromCard(card: FeedItem): ListingSummary {
  return {
    id: card.listingId,
    source: 'facebook',
    title: card.title,
    ask: {
      amountMinor: card.priceMinor,
      currency: card.currency as ListingSummary['ask']['currency'],
    },
    town: card.pickup?.townOrArea ?? card.townLabel ?? 'Location not stated',
    // No distance module wired yet (task L1; docs/questions/L1-web.md).
    distanceKm: null,
    // collection is yes/no/unknown; postage is field/text/none (where the signal came from, not
    // a yes/no) — packages/contracts/src/modules/pickup-location.ts, `PickupLocationUserRow`.
    delivery: card.pickup
      ? card.pickup.collection === 'yes' && card.pickup.postage !== 'none'
        ? 'both'
        : card.pickup.collection === 'yes'
          ? 'collection'
          : card.pickup.postage !== 'none'
            ? 'posted'
            : 'unknown'
      : 'unknown',
    condition: card.condition ?? undefined,
    keyFacts: [
      {
        label: 'Condition',
        value: card.condition ?? undefined,
        status: card.condition ? 'stated' : 'not_stated',
      },
      {
        label: 'Availability',
        value: card.availability ?? undefined,
        status: card.availability ? 'stated' : 'not_stated',
      },
    ],
    photoCount: 0, // listing photos stay off (docs/decisions.md, "MVP scope and pipeline runtime")
    freshness: { listedAt: card.listedAt.toISOString(), foundAt: card.listedAt.toISOString() },
    listingUrl: card.link ?? '#',
  }
}

function dealFromCard(card: FeedItem): Deal {
  return {
    id: card.listingId,
    huntId: '',
    huntName: '',
    listing: listingFromCard(card),
    // No spec-match module yet: this is not shown as "matched" to any hunt (docs/questions/L1-web.md).
    matchReason: 'New listing',
    position: null,
    suspicions: [],
    warnings: [],
    priceChanges: [],
    preparedMessage: '',
    checklist: [],
  }
}

export async function listDeals(query: DealQuery = {}): Promise<Deal[]> {
  await requireUser()
  const cards = await call(router.feed.list, undefined, await rpcCallOptions())
  const needle = query.q?.trim().toLowerCase()
  return cards
    .filter((card) => !needle || card.title.toLowerCase().includes(needle))
    .map(dealFromCard)
}

export async function getDeal(id: string): Promise<Deal | undefined> {
  await requireUser()
  const card = await call(router.listing.get, { listingId: id }, await rpcCallOptions())
  if (!card) return undefined
  const [preparedMessage, watch] = await Promise.all([
    call(router.listing.preparedMessage, { listingId: id }, await rpcCallOptions()),
    call(router.listing.watch, { listingId: id }, await rpcCallOptions()),
  ])
  return {
    ...dealFromCard(card),
    preparedMessage: preparedMessage
      ? preparedMessage.text
      : 'No prepared message yet for this listing.',
    checklist: preparedMessage ? preparedMessage.checklist.map((item) => item.text) : [],
    priceChanges: watch.history.map((h) => ({ at: h.at, ask: h.ask })),
  }
}

/** Examples for the /design page and the onboarding preview: always fixtures, never real
 * listings (`docs/design/onboarding-journeys.md`). */
export async function listExampleDeals(): Promise<{ deals: Deal[]; irish: Deal }> {
  return { deals: exampleDeals, irish: irishDeal }
}

function huntFromWant(want: WantManagerWant, channels: string[]): Hunt {
  const terms = want.criteria.map((c) => c.family ?? c.catalogueId ?? c.partType)
  return {
    id: want.id,
    // A want has no name or category field (docs/questions/L1-web.md); derived from its criteria.
    name: terms.join(', ') || 'Untitled hunt',
    terms,
    category: 'GPUs and gaming PCs',
    // The postcode is never stored (services/want-manager/README.md); the centre is the closest
    // honest substitute for a location label.
    postcodeDistrict: want.centreId ?? 'Area not yet confirmed',
    radiusKm: want.radiusKm,
    maxAsk:
      want.priceCapMinor != null
        ? { amountMinor: want.priceCapMinor, currency: want.currency }
        : undefined,
    delivery:
      want.deliveryMethods.length === 2
        ? 'all'
        : (want.deliveryMethods[0] as 'collection' | 'posted'),
    cadenceSeconds: want.cadenceSeconds,
    status: want.active ? 'active' : 'paused',
    // alert-router is not built yet, so this is an honest zero, not an estimate.
    alertsThisWeek: 0,
    channels: channels as Hunt['channels'],
  }
}

export async function listHunts(): Promise<Hunt[]> {
  await requireUser()
  const [wants, prefs] = await Promise.all([
    call(router.wants.list, undefined, await rpcCallOptions()),
    call(router.preferences.get, undefined, await rpcCallOptions()),
  ])
  return wants.map((want) => huntFromWant(want, prefs.channels))
}

export async function getHunt(id: string): Promise<Hunt | undefined> {
  const found = await listHunts()
  return found.find((hunt) => hunt.id === id)
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return dashboardSummary
}

export async function listChannels(): Promise<Channel[]> {
  return channels
}

export async function listAlertDeliveries(): Promise<AlertDelivery[]> {
  return alertDeliveries
}

export async function getAccount(): Promise<Account> {
  const session = await requireUser()
  const profile = await call(router.account.profile, undefined, await rpcCallOptions())
  return {
    email: session.user.email,
    displayName: profile?.displayName ?? session.user.name ?? session.user.email,
    homeArea: null,
    // Google sign-in is not configured for the local run (docs/decisions.md, "Local single-user
    // run first" lists no GOOGLE_OAUTH_* variable).
    signInMethods: ['magic_link'],
    createdAt: profile?.createdAt ?? session.user.createdAt.toISOString(),
  }
}

export async function getPreferences(): Promise<Preferences> {
  return preferences
}

/**
 * Admin fixtures never reach a production admin page (docs/design/admin-hardening.md, H13 and
 * A11). `next build` and `next start` set NODE_ENV to `production`, so a deployed admin page
 * fails rather than show fixture spend and runs as if they were real, until task 4.1 replaces
 * these two bodies with the audited procedures. Read at call time, from `@nabvy/config`.
 */
function refuseAdminFixturesInProduction(): void {
  if (loadEnv(['runtime']).NODE_ENV === 'production') {
    throw new Error(
      'Admin fixtures are not served in production (task 4.3af, H13); the admin procedures arrive with task 4.1',
    )
  }
}

export async function getAdminOverview(): Promise<AdminOverview> {
  refuseAdminFixturesInProduction()
  return adminOverview
}

export async function listReviewQueue(): Promise<ReviewItem[]> {
  refuseAdminFixturesInProduction()
  return reviewQueue
}
