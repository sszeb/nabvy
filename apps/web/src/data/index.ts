/**
 * The web app's data-access layer. Screens call only these functions. Today they return typed
 * fixtures; each one is replaced by a call to the matching oRPC procedure (task 4.1) with the
 * same signature, so no screen changes when real data arrives (apps/web/README.md).
 *
 * Every function is async on purpose, so screens already await them the way they will await
 * procedures.
 */
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

export async function getAdminOverview(): Promise<AdminOverview> {
  return adminOverview
}

export async function listReviewQueue(): Promise<ReviewItem[]> {
  return reviewQueue
}
