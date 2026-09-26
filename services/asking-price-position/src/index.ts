// Public API of the asking-price-position module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/asking-price-position' only, never from its internals. It shows
// where a listing's ask sits among the asks of its asking-price-index group: rank, n, median and
// range, to users only at n>=10 (README.md). It never says "worth", "fair" or "sale price", shows no
// score, suggests no offer and checks no price cut (PARTS_INTELLIGENCE.md:179-181,365-367).

import { createHash } from 'node:crypto'
import {
  ASKING_PRICE_POSITION_EVENT_BATCH_SIZE,
  ASKING_PRICE_POSITION_MAD_SCALE,
  ASKING_PRICE_POSITION_MIN_NEW_CONTEXT_N,
  ASKING_PRICE_POSITION_RULE_VERSION,
} from '@nabvy/config/modules/asking-price-position'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import { AskingPricePositionInput, events } from '@nabvy/contracts/modules/asking-price-position'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import { chunk, newGroupKeyOf, place, positionable, robustZ } from './domain'
import {
  deletePosition,
  deletePositionsOf,
  lockPositions,
  type PositionRow,
  type StoredPosition,
  selectGroups,
  selectMembers,
  selectPositions,
  selectVersions,
  upsertPosition,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/asking-price-position'
export { newGroupKeyOf, place, positionable, robustZ, shown } from './domain'
export { updatedHandler } from './handlers'

const MODULE = 'asking-price-position'

export interface PositionOptions {
  /** T4: the time positions are written at; defaults to now (server time). Tests pin it. */
  now?: Date
}

/** What one `position` call did. */
export interface PositionReport {
  /**
   * False while this module, the pipeline or asking-price-index is off: nothing was read, written
   * or announced.
   */
  open: boolean
  groups: number
  /** Listings whose position was written or removed. */
  positioned: string[]
  /** `positioned` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Positions every member of these asking-price-index groups against the group's counted asks, and
 * removes positions of listings that left a group or no longer count. Safe to run twice: a
 * position is rewritten only when its listing's hashes, the group's `as_of`, the rule version or
 * a figure changed (rule 8), so a replay writes nothing and announces nothing.
 */
export async function position(
  q: Queryable,
  input: { groupKeys: string[] },
  options: PositionOptions = {},
): Promise<Result<PositionReport, AppError>> {
  const parsed = AskingPricePositionInput.safeParse(input)
  if (!parsed.success) {
    return err({ code: 'asking-price-position.invalid_input', message: parsed.error.message })
  }
  const groupKeys = [...new Set(parsed.data.groupKeys)].sort()
  const report: PositionReport = {
    open: false,
    groups: groupKeys.length,
    positioned: [],
    events: [],
  }
  if (
    (await state(q, MODULE)) === 'off' ||
    !(await isOn(q, 'pipeline')) ||
    // With the index off its views are empty; reading that as "every group is gone" would wipe
    // positions a restart restores, so nothing is done until it is back (rule 11).
    (await state(q, 'asking-price-index')) === 'off'
  ) {
    return ok(report)
  }
  report.open = true
  await lockPositions(q)

  const newKeys = groupKeys.map(newGroupKeyOf).filter((k): k is string => k !== null)
  const groups = await selectGroups(q, [...new Set([...groupKeys, ...newKeys])])
  const members = await selectMembers(q, groupKeys)
  const versions = await selectVersions(q, [
    ...new Set(members.filter(positionable).map((m) => m.listingId)),
  ])
  const stored = await selectPositions(q, groupKeys)
  const storedByKey = new Map(stored.map((p) => [`${p.groupKey}\u0000${p.listingId}`, p]))
  const now = options.now ?? new Date()
  const changed = new Set<string>()
  const versionsOf: string[] = []

  for (const groupKey of groupKeys) {
    const figures = groups.get(groupKey)
    const rows = members.filter((m) => m.groupKey === groupKey)
    const counted = rows.filter((m) => m.counted).map((m) => m.askMinor)
    const newKey = newGroupKeyOf(groupKey)
    const newGroup = newKey === null ? undefined : groups.get(newKey)
    const newContext =
      newGroup && newGroup.n >= ASKING_PRICE_POSITION_MIN_NEW_CONTEXT_N && newGroup.median !== null
        ? { newMedian: newGroup.median, newN: newGroup.n }
        : { newMedian: null, newN: null }
    if (figures) versionsOf.push(`${groupKey}@${figures.asOf.toISOString()}`)
    const wanted = new Set<string>()
    for (const m of figures ? rows.filter(positionable) : []) {
      const version = versions.get(m.listingId)
      if (!figures || !version) continue
      wanted.add(m.listingId)
      const row: PositionRow = {
        listingId: m.listingId,
        groupKey,
        askMinor: m.askMinor,
        ...place(m.askMinor, counted),
        n: figures.n,
        robustZ: robustZ(m.askMinor, figures.median, figures.mad, ASKING_PRICE_POSITION_MAD_SCALE),
        label: figures.label,
        median: figures.median,
        rangeLow: figures.p25,
        rangeHigh: figures.p75,
        currency: figures.currency,
        ...newContext,
        cardHash: version.cardHash,
        evidenceHash: version.evidenceHash,
        statsAsOf: figures.asOf,
        ruleVersion: ASKING_PRICE_POSITION_RULE_VERSION,
        positionedAt: now,
      }
      const before = storedByKey.get(`${groupKey}\u0000${m.listingId}`)
      if (before && samePosition(before, row)) continue
      await upsertPosition(q, row)
      changed.add(m.listingId)
    }
    for (const p of stored) {
      if (p.groupKey !== groupKey || wanted.has(p.listingId)) continue
      await deletePosition(q, p.listingId, groupKey)
      changed.add(p.listingId)
    }
  }
  report.positioned = [...changed].sort()
  report.events = positionedEvents(report.positioned, versionsOf)
  return ok(report)
}

const COMPARED = [
  'askMinor',
  'rank',
  'n',
  'percentile',
  'robustZ',
  'label',
  'median',
  'rangeLow',
  'rangeHigh',
  'currency',
  'newMedian',
  'newN',
  'cardHash',
  'evidenceHash',
  'ruleVersion',
] as const

function samePosition(before: StoredPosition, next: PositionRow): boolean {
  return (
    COMPARED.every((k) => (before[k] ?? null) === (next[k] ?? null)) &&
    before.statsAsOf.getTime() === next.statsAsOf.getTime()
  )
}

function positionedEvents(listingIds: string[], groupVersions: string[]): EventEnvelope[] {
  return chunk(listingIds, ASKING_PRICE_POSITION_EVENT_BATCH_SIZE).map((batch) => {
    // Keyed by the listings and the group key@as_of versions they were positioned against (rule 8).
    const version = createHash('sha256')
      .update(`${batch.join('\n')}@${groupVersions.join('\n')}`)
      .digest('hex')
      .slice(0, 16)
    return createEvent(
      events,
      'asking-price-position.positioned',
      1,
      { listingIds: batch },
      { key: `asking-price-position.positioned:${version}` },
    )
  }) as EventEnvelope[]
}

/**
 * Removes every position of these listings (rule 12: `seller-rights` erasure). Runs whatever the
 * switch says. Returns how many listings had a position.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk([...new Set(listingIds)], ASKING_PRICE_POSITION_EVENT_BATCH_SIZE)) {
    removed += (await deletePositionsOf(q, batch)).length
  }
  return removed
}
