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
import {
  account,
  alertDeliveries,
  channels,
  dashboardSummary,
  FIXTURE_AS_OF,
  hunts,
  preferences,
} from './fixtures/account'
import { adminOverview, reviewQueue } from './fixtures/admin'
import { deals, irishDeal } from './fixtures/deals'
import type {
  Account,
  AdminOverview,
  AlertDelivery,
  Channel,
  DashboardSummary,
  Deal,
  Hunt,
  Preferences,
  ReviewItem,
} from './types'

export type DealQuery = {
  /** Free text matched against the title, key facts and hunt name. */
  q?: string
  huntId?: string
  /** Only deals whose ask sits in the lowest quarter of at least ten comparable asks. */
  lowAsksOnly?: boolean
}

export async function getAsOf(): Promise<string> {
  return FIXTURE_AS_OF
}

export async function listDeals(query: DealQuery = {}): Promise<Deal[]> {
  const needle = query.q?.trim().toLowerCase()
  return deals
    .filter((deal) => !query.huntId || deal.huntId === query.huntId)
    .filter(
      (deal) =>
        !query.lowAsksOnly ||
        (deal.position.comparableCount >= 10 && deal.position.percentile <= 25),
    )
    .filter((deal) => {
      if (!needle) return true
      const haystack = [
        deal.listing.title,
        deal.huntName,
        deal.listing.town,
        ...deal.listing.keyFacts.map((fact) => fact.value ?? ''),
      ]
        .join(' ')
        .toLowerCase()
      return needle.split(/\s+/).every((word) => haystack.includes(word))
    })
    .sort(
      (a, b) => Date.parse(b.listing.freshness.foundAt) - Date.parse(a.listing.freshness.foundAt),
    )
}

export async function getDeal(id: string): Promise<Deal | undefined> {
  return [...deals, irishDeal].find((deal) => deal.id === id)
}

/** Examples for the /design page and the onboarding preview. */
export async function listExampleDeals(): Promise<{ deals: Deal[]; irish: Deal }> {
  return { deals, irish: irishDeal }
}

export async function listHunts(): Promise<Hunt[]> {
  return hunts
}

export async function getHunt(id: string): Promise<Hunt | undefined> {
  return hunts.find((hunt) => hunt.id === id)
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
  return account
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
