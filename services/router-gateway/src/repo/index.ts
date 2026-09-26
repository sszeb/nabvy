// Database access: this module's own table only (router_gateway.router_calls). Called inside
// withPipeline. Nothing here ever receives a coordinate, a key or a response body.
import type {
  RouterCallKind,
  RouterCallStatus,
  RouterProviderName,
} from '@nabvy/contracts/modules/router-gateway'
import type { Queryable } from '@nabvy/db'
import { routerCalls } from '@nabvy/db/schema/router-gateway'
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm'
import { COUNTED_STATUSES, minuteStart, utcDayStart, withinQuota } from '../domain'

export interface CallSlot {
  provider: RouterProviderName
  kind: RouterCallKind
  locationCount: number
}

/** Counted calls of one provider and kind today (UTC) and in the last minute. */
async function countCalls(
  q: Queryable,
  slot: Omit<CallSlot, 'locationCount'>,
  now: Date,
): Promise<{ today: number; lastMinute: number }> {
  const [counts] = await q
    .select({
      today: sql<number>`count(*)::int`,
      lastMinute: sql<number>`(count(*) filter (where ${routerCalls.at} >= ${minuteStart(now)}))::int`,
    })
    .from(routerCalls)
    .where(
      and(
        eq(routerCalls.provider, slot.provider),
        eq(routerCalls.kind, slot.kind),
        inArray(routerCalls.status, [...COUNTED_STATUSES]),
        gte(routerCalls.at, utcDayStart(now)),
      ),
    )
  return counts ?? { today: 0, lastMinute: 0 }
}

/**
 * Reserves one call against the caps: takes a transaction-scoped advisory lock per provider and
 * kind (so concurrent reservations in transactions queue rather than overshoot), counts today's
 * and the last minute's counted calls, and inserts a `pending` row if one more fits, or a
 * `refused_quota` row if not. Returns the pending row's id, or null when refused.
 */
export async function reserve(
  q: Queryable,
  slot: CallSlot,
  cap: { perDay: number; perMinute: number },
  now: Date,
): Promise<string | null> {
  await q.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`router_gateway:${slot.provider}:${slot.kind}`}))`,
  )
  const counts = await countCalls(q, slot, now)
  const fits = withinQuota(counts, cap)
  const [row] = await q
    .insert(routerCalls)
    .values({ ...slot, status: fits ? 'pending' : 'refused_quota', at: now })
    .returning({ id: routerCalls.id })
  return fits && row ? row.id : null
}

/** Records a reserved call's outcome, once. */
export async function settle(
  q: Queryable,
  id: string,
  outcome: {
    status: Exclude<RouterCallStatus, 'pending' | 'refused_quota'>
    latencyMs: number
    build: string | null
  },
): Promise<void> {
  await q
    .update(routerCalls)
    .set({
      status: outcome.status,
      latencyMs: Math.max(0, Math.round(outcome.latencyMs)),
      build: outcome.build,
    })
    .where(and(eq(routerCalls.id, id), eq(routerCalls.status, 'pending')))
}

/** The newest successful call before `id`, of any provider: what callers' cached times came from. */
export async function previousSuccess(
  q: Queryable,
  id: string,
): Promise<{ provider: RouterProviderName; build: string | null } | null> {
  const [row] = await q
    .select({ provider: routerCalls.provider, build: routerCalls.build })
    .from(routerCalls)
    .where(
      and(eq(routerCalls.status, 'ok'), ne(routerCalls.id, id), sql`${routerCalls.id} < ${id}`),
    )
    .orderBy(desc(routerCalls.id))
    .limit(1)
  return row ? { provider: row.provider as RouterProviderName, build: row.build } : null
}

/** Statuses of this provider's calls since `since`, newest first (for health). */
export async function recentStatuses(
  q: Queryable,
  provider: RouterProviderName,
  since: Date,
): Promise<{ statuses: RouterCallStatus[]; lastBuild: string | null }> {
  const rows = await q
    .select({ status: routerCalls.status, build: routerCalls.build })
    .from(routerCalls)
    .where(and(eq(routerCalls.provider, provider), gte(routerCalls.at, since)))
    .orderBy(desc(routerCalls.id))
    .limit(50)
  return {
    statuses: rows.map((row) => row.status as RouterCallStatus),
    lastBuild: rows.find((row) => row.status === 'ok')?.build ?? null,
  }
}

/** Whether a kind is at its cap now, without reserving (for health). */
export async function atCap(
  q: Queryable,
  slot: Omit<CallSlot, 'locationCount'>,
  cap: { perDay: number; perMinute: number },
  now: Date,
): Promise<boolean> {
  const counts = await countCalls(q, slot, now)
  return !withinQuota(counts, cap)
}
