import type {
  RouterCallStatus,
  RouterHealth,
  RouterProviderName,
} from '@nabvy/contracts/modules/router-gateway'

/** Statuses that reached the provider (or reserved a call to it) and so count against a cap. */
export const COUNTED_STATUSES: readonly RouterCallStatus[] = [
  'pending',
  'ok',
  'provider_quota',
  'http_error',
  'invalid_response',
  'timeout',
  'network_error',
]

/** Start of the UTC day of `now`: the plan's daily quota is counted per UTC day. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** One minute before `now`: the per-minute window. */
export function minuteStart(now: Date): Date {
  return new Date(now.getTime() - 60_000)
}

/** Whether one more call fits under both caps, given the calls already counted. */
export function withinQuota(
  counts: { today: number; lastMinute: number },
  cap: { perDay: number; perMinute: number },
): boolean {
  return counts.today < cap.perDay && counts.lastMinute < cap.perMinute
}

/**
 * Whether a successful call means callers must drop cached times: the provider changed, or the
 * same provider reported a different data build. The first call ever has nothing cached before it.
 */
export function buildChanged(
  previous: { provider: RouterProviderName; build: string | null } | null,
  current: { provider: RouterProviderName; build: string | null },
): boolean {
  if (!previous) return false
  if (previous.provider !== current.provider) return true
  return current.build !== null && previous.build !== current.build
}

const FAILED: readonly RouterCallStatus[] = [
  'http_error',
  'timeout',
  'network_error',
  'invalid_response',
]

/**
 * The provider's health from the calls settled in the recent window, newest first. openrouteservice
 * has no health endpoint on its public API, so the gateway judges from real traffic rather than
 * spend quota on a probe: the newest settled call decides.
 */
export function judgeHealth(recent: readonly RouterCallStatus[]): RouterHealth['status'] {
  const settled = recent.filter((status) => status !== 'pending' && status !== 'refused_quota')
  const newest = settled[0]
  if (newest === undefined) return 'unknown'
  if (newest === 'ok') return 'ok'
  if (newest === 'provider_quota') return 'quota'
  return FAILED.includes(newest) ? 'down' : 'unknown'
}
