// Public API of the copy-advert module: the functions other modules and tasks may call. Finds
// adverts copied and mass-posted across city pages, counts each copy cluster once for internal
// readers, and publishes a per-listing flag with facts only (README.md).
import { record } from '@nabvy/audit-log'
import { batchKey, createEvent, type EventEnvelope, type Result } from '@nabvy/contracts'
import {
  type CopyAdvertCorrection,
  CopyAdvertCorrection as CopyAdvertCorrectionSchema,
  type CopyAdvertReportInput,
  CopyAdvertReportInput as CopyAdvertReportInputSchema,
  events,
} from '@nabvy/contracts/modules/copy-advert'
import type { Queryable } from '@nabvy/db'
import { enqueue } from '@nabvy/details-queue'
import { isOn, state } from '@nabvy/switches'
import {
  advertFingerprint,
  candidateEligible,
  chunk,
  clusterFacts,
  components,
  clusterKey as computeClusterKey,
  confirmBasis,
  descFingerprint,
  hasPriceFingerprint,
  isTextCopy,
  listingFacts,
  memberSetHash,
  normaliseText,
  RULE_VERSION,
  RULES,
  townGroups,
} from './domain'
import {
  alreadyRequested,
  closeMembership,
  deleteFlag,
  deleteReportsForUser,
  eraseListings,
  expireCluster,
  insertCandidateRequest,
  insertOverride,
  insertReport,
  markPhotoIdMatch,
  selectActiveClusterKeys,
  selectActiveMembers,
  selectByAdvertFp,
  selectByPhotoId,
  selectCandidateCountToday,
  selectCityPageLabels,
  selectConfirmedLinksTouching,
  selectExpiredMembers,
  selectInArea,
  selectListingInputs,
  selectSimilarity,
  selectSuppressed,
  selectTextCopyCandidates,
  upsertCluster,
  upsertFlag,
  upsertLink,
  upsertMember,
  upsertPhotoMatch,
  upsertPrint,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/copy-advert'
export { RULE_VERSION } from './domain'

/** What `recompute()` did with this batch. */
export interface RecomputeReport {
  /** Listings whose membership or facts changed (at most 500 per emitted event). */
  changedListingIds: string[]
  /** `copy-advert.clustered` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Runs S1-S9 for a batch of listings (100-500 IDs): normalises and fingerprints each listing's
 * current card and description (S1), groups by `advert_fp` and confirms by description (S2-S3),
 * requests details for undescribed collision candidates (S4), records internal text-copy and
 * photo-ID evidence (S5-S6), recomputes affected clusters (S8) and their facts and flags (S9).
 * Safe to run twice: every write is an upsert keyed so a replay changes nothing.
 */
export async function recompute(
  q: Queryable,
  input: { listingIds: string[]; now?: Date },
): Promise<Result<RecomputeReport>> {
  const now = input.now ?? new Date()
  const listingIds = [...new Set(input.listingIds)]
  if (listingIds.length === 0) return { ok: true, value: { changedListingIds: [], events: [] } }
  // Off: acknowledge and write nothing; the same while the global pipeline switch is off (rule 11).
  // Shadow behaves like on: this module has no user-facing output, so shadow still writes.
  if ((await state(q, 'copy-advert')) === 'off' || !(await isOn(q, 'pipeline'))) {
    return { ok: true, value: { changedListingIds: [], events: [] } }
  }

  const windowStart = new Date(now.getTime() - RULES.windowDays * 24 * 60 * 60 * 1000)
  const rows = await selectListingInputs(q, listingIds)
  const touched = new Set<string>()

  for (const row of rows) {
    const titleNorm = normaliseText(row.title)
    const advertFp = hasPriceFingerprint(row)
      ? advertFingerprint(titleNorm, row.priceMinor as number, row.currency as string)
      : null
    const isFull = row.descStatus === 'full_verified'
    const descNorm = isFull && row.description ? normaliseText(row.description) : null
    const descFp = descNorm !== null ? descFingerprint(descNorm) : null

    await upsertPrint(q, {
      listingId: row.listingId,
      source: row.source,
      sourceListingId: row.sourceListingId,
      cardHash: row.cardHash,
      evidenceHash: row.evidenceHash,
      ruleVersion: RULE_VERSION,
      titleNorm,
      priceMinor: row.priceMinor,
      currency: row.currency,
      advertFp,
      descStatus: row.descStatus,
      descNorm,
      descFp,
      photoId: row.photoId,
      cityPageId: row.cityPageId,
      listedAt: row.listedAt,
      lastSeenAt: row.lastSeenAt,
      inputT1: row.listedAt,
      doneAt: now,
    })
    touched.add(row.listingId)

    // S2 + S3/S4: other current prints sharing this advert_fp.
    const undescribed: Array<{
      listingId: string
      sourceListingId: string
      cityPageId: string | null
      titleNormLen: number
      advertFp: string
    }> = []
    if (advertFp) {
      const matches = await selectByAdvertFp(q, advertFp, RULE_VERSION, row.listingId, windowStart)
      for (const match of matches) {
        if (isFull && match.descStatus === 'full_verified' && descFp && match.descFp) {
          const similarity =
            descFp === match.descFp || descNorm === null || match.descNorm === null
              ? 1
              : await selectSimilarity(q, descNorm, match.descNorm)
          const basis = confirmBasis({
            titleNormLen: titleNorm.length,
            descFpA: descFp,
            descFpB: match.descFp,
            descLenA: descNorm?.length ?? 0,
            descLenB: match.descNorm?.length ?? 0,
            similarity,
            rules: RULES,
          })
          await upsertLink(q, {
            listingA: row.listingId,
            listingB: match.listingId,
            basis,
            similarity: basis === 'exact_text' ? null : similarity,
            photoIdMatch: false,
            ruleVersion: RULE_VERSION,
            decidedAt: now,
          })
          if (basis === 'exact_text' || basis === 'near_text') {
            touched.add(match.listingId)
          }
        } else {
          await upsertLink(q, {
            listingA: row.listingId,
            listingB: match.listingId,
            basis: 'candidate',
            similarity: null,
            photoIdMatch: false,
            ruleVersion: RULE_VERSION,
            decidedAt: now,
          })
          if (!isFull) {
            undescribed.push({
              listingId: row.listingId,
              sourceListingId: row.sourceListingId,
              cityPageId: row.cityPageId,
              titleNormLen: titleNorm.length,
              advertFp,
            })
          }
          if (match.descStatus !== 'full_verified') {
            undescribed.push({
              listingId: match.listingId,
              sourceListingId: match.sourceListingId,
              cityPageId: null,
              titleNormLen: titleNorm.length,
              advertFp,
            })
          }
        }
      }
    }
    await requestCandidates(q, undescribed, now)

    // S5: text copies (internal only), any advert_fp.
    if (descFp && descNorm) {
      const copies = await selectTextCopyCandidates(q, {
        descNorm,
        ruleVersion: RULE_VERSION,
        excludeListingId: row.listingId,
        threshold: RULES.textCopy,
        sinceDate: windowStart,
      })
      for (const c of copies) {
        if (c.advertFp === advertFp) continue // same advert_fp is S2/S3's pair, not a text copy
        const similarity =
          c.descFp === descFp ? 1 : await selectSimilarity(q, descNorm, c.descNorm ?? '')
        if (
          isTextCopy({
            descFpA: descFp,
            descFpB: c.descFp ?? '',
            descLenA: descNorm.length,
            descLenB: c.descNorm?.length ?? 0,
            similarity,
            rules: RULES,
          })
        ) {
          await upsertLink(q, {
            listingA: row.listingId,
            listingB: c.listingId,
            basis: 'text_copy',
            similarity,
            photoIdMatch: false,
            ruleVersion: RULE_VERSION,
            decidedAt: now,
          })
        }
      }
    }

    // S6: photo-ID evidence.
    if (row.photoId) {
      const photoMatches = await selectByPhotoId(q, row.photoId, RULE_VERSION, row.listingId)
      for (const m of photoMatches) {
        await upsertPhotoMatch(q, {
          listingA: row.listingId,
          listingB: m.listingId,
          photoId: row.photoId,
          ruleVersion: RULE_VERSION,
          foundAt: now,
        })
        await markPhotoIdMatch(q, row.listingId, m.listingId, RULE_VERSION)
      }
    }
  }

  const changed = await recomputeClusters(q, [...touched], now)
  const batches = chunk(changed, 500)
  const eventEnvelopes: EventEnvelope[] = []
  for (const batch of batches) {
    const key = await batchKey('copy-advert.clustered', batch)
    eventEnvelopes.push(
      createEvent(
        events,
        'copy-advert.clustered',
        1,
        { listingIds: batch, ruleVersion: RULE_VERSION },
        { key },
      ) as EventEnvelope,
    )
  }
  return { ok: true, value: { changedListingIds: changed, events: eventEnvelopes } }
}

/**
 * S4: requests details for eligible undescribed candidates, within the daily cap. Priority
 * 'sweep' stands in for "after sweep follow-ups (lowest)": details-queue's four priorities do not
 * yet list one lower (docs/design/drafts/copy-advert.md 4.12; README.md, "Decisions").
 */
async function requestCandidates(
  q: Queryable,
  candidates: Array<{
    listingId: string
    sourceListingId: string
    cityPageId: string | null
    titleNormLen: number
    advertFp: string
  }>,
  now: Date,
): Promise<void> {
  if (candidates.length === 0) return
  const unique = [...new Map(candidates.map((c) => [c.listingId, c])).values()]
  const already = await alreadyRequested(
    q,
    unique.map((c) => c.listingId),
  )
  const fresh = unique.filter((c) => !already.has(c.listingId))
  if (fresh.length === 0) return
  const inArea = await selectInArea(
    q,
    fresh.map((c) => c.cityPageId).filter((id): id is string => id !== null),
  )
  const eligible = fresh.filter((c) =>
    candidateEligible(c.titleNormLen, c.cityPageId !== null && inArea.has(c.cityPageId), RULES),
  )
  if (eligible.length === 0) return
  const midnight = new Date(now)
  midnight.setUTCHours(0, 0, 0, 0)
  const usedToday = await selectCandidateCountToday(q, midnight)
  const room = Math.max(RULES.candidateDailyCap - usedToday, 0)
  const send = eligible.slice(0, room)
  if (send.length === 0) return
  for (const c of send)
    await insertCandidateRequest(q, {
      listingId: c.listingId,
      advertFp: c.advertFp,
      requestedAt: now,
    })
  await enqueue(q, {
    source: 'facebook',
    sourceListingIds: send.map((c) => c.sourceListingId),
    priority: 'sweep',
    lane: 'text',
    reason: 'collision-candidate',
    requestedBy: 'copy-advert',
  })
}

/** S7 (developer text copies included): recomputes every cluster touched by these listings. */
async function recomputeClusters(
  q: Queryable,
  touchedListingIds: string[],
  now: Date,
): Promise<string[]> {
  if (touchedListingIds.length === 0) return []
  const changed = new Set<string>()

  // Close old memberships for listings whose links no longer support them: recomputed below from
  // scratch by rebuilding the connected component of every touched listing.
  const seen = new Set<string>()
  let frontier = [...new Set(touchedListingIds)]
  const edges: Array<{ a: string; b: string }> = []
  while (frontier.length > 0) {
    const links = await selectConfirmedLinksTouching(q, frontier, RULE_VERSION)
    const next: string[] = []
    for (const l of links) {
      edges.push({ a: l.listingA, b: l.listingB })
      for (const id of [l.listingA, l.listingB]) {
        if (!seen.has(id)) {
          seen.add(id)
          next.push(id)
        }
      }
    }
    frontier = next
  }
  const allNodes = [...new Set([...touchedListingIds, ...seen])]
  const groups = components(allNodes, edges).filter(
    (g) => g.length > 1 || edges.some((e) => e.a === g[0] || e.b === g[0]),
  )

  const oldClusterKeys = await selectActiveClusterKeys(q, allNodes)
  // Every listing that ends up an active member of some (possibly new-keyed) cluster this pass.
  // A cluster's key depends on its earliest-listed member (docs 4.8), so it can change when that
  // member leaves (suppressed, or expired): the old key is never assumed stable across a pass.
  const stillAssigned = new Set<string>()

  for (const group of groups) {
    const suppressed = await selectSuppressed(q, group)
    const activeGroup = group.filter((id) => !suppressed.has(id))
    if (activeGroup.length < 2) {
      // No longer a cluster: nothing to assign. Cleanup below closes every old membership here.
      continue
    }

    const infoRows = await selectListingInputs(q, activeGroup)
    const infoById = new Map(infoRows.map((r) => [r.listingId, r]))
    const cityPageIds = [
      ...new Set(infoRows.map((r) => r.cityPageId).filter((id): id is string => id !== null)),
    ]
    const pages = await selectCityPageLabels(q, cityPageIds)
    const townOf = townGroups(pages.map((p) => ({ cityPageId: p.cityPageId, labels: p.labels })))
    const coordsByPage = new Map(pages.map((p) => [p.cityPageId, { lat: p.lat, lng: p.lng }]))

    const clusterMembers = activeGroup.map((id) => {
      const r = infoById.get(id)
      const coords = r?.cityPageId ? coordsByPage.get(r.cityPageId) : undefined
      return {
        listingId: id,
        sourceListingId: r?.sourceListingId ?? id,
        cityPageId: r?.cityPageId ?? null,
        listedAt: r?.listedAt ?? null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      }
    })

    const facts = clusterFacts(clusterMembers, townOf, RULES)
    const key = computeClusterKey(RULE_VERSION, clusterMembers)
    const hash = memberSetHash(activeGroup)
    const first = infoById.get(activeGroup[0] as string)

    await upsertCluster(q, {
      clusterKey: key,
      ruleVersion: RULE_VERSION,
      memberSetHash: hash,
      priceMinor: first?.priceMinor ?? null,
      currency: first?.currency ?? null,
      listingCount: facts.listingCount,
      townCount: facts.townCount,
      spanDays: facts.spanDays,
      spreadKm: facts.spreadKm,
      massPosted: facts.massPosted,
      asOf: now,
    })

    for (const m of clusterMembers) {
      // A link's basis between any two members may differ pairwise; the member's own basis is
      // recorded as exact_text unless it only reached the group through a near_text hop.
      const hasNearHop = edges.some(
        (e) =>
          (e.a === m.listingId || e.b === m.listingId) &&
          group.includes(e.a === m.listingId ? e.b : e.a),
      )
      // Close any other active membership first: `members_one_active_idx` allows at most one
      // active (left_at is null) row per listing, and a re-keyed cluster (its earliest-listed
      // member changed) would otherwise collide with the still-open old row on insert.
      const previous = oldClusterKeys.get(m.listingId)
      if (previous && previous !== key) await closeMembership(q, previous, m.listingId, now)
      await upsertMember(q, {
        clusterKey: key,
        listingId: m.listingId,
        sourceListingId: m.sourceListingId,
        cityPageId: m.cityPageId,
        basis: hasNearHop ? 'near_text' : 'exact_text',
        joinedAt: now,
      })

      const lf = listingFacts(m, clusterMembers, townOf)
      const wouldShow = facts.massPosted && lf.towns >= RULES.flagMinTowns
      await upsertFlag(q, {
        listingId: m.listingId,
        clusterKey: key,
        towns: lf.towns,
        spanDays: lf.spanDays,
        wouldShow,
        ruleVersion: RULE_VERSION,
        memberSetHash: hash,
      })
      changed.add(m.listingId)
      stillAssigned.add(m.listingId)
    }
  }

  // Every touched listing with an old membership that did not carry over into an active cluster
  // this pass (suppressed, split off by a correction, or its cluster fell below two members):
  // close it and drop its flag, whatever cluster key it used to carry.
  for (const [listingId, oldKey] of oldClusterKeys) {
    if (!stillAssigned.has(listingId)) {
      await closeMembership(q, oldKey, listingId, now)
      await deleteFlag(q, listingId)
      changed.add(listingId)
    }
  }

  // A cluster key touched this pass that now has no active member (every member moved to a new
  // key, or dropped out) is expired, so it stops appearing as an active cluster.
  for (const oldKey of new Set(oldClusterKeys.values())) {
    const remaining = await selectActiveMembers(q, [oldKey])
    if (remaining.length === 0) await expireCluster(q, oldKey)
  }

  return [...changed]
}

/** Daily scheduled `copy-advert-expire`: drops members past the window and recomputes their clusters. */
export async function expireWindow(q: Queryable, now: Date = new Date()): Promise<RecomputeReport> {
  const cutoff = new Date(now.getTime() - RULES.windowDays * 24 * 60 * 60 * 1000)
  const expired = await selectExpiredMembers(q, cutoff)
  if (expired.length === 0) return { changedListingIds: [], events: [] }
  const listingIds = expired.map((m) => m.listingId)
  for (const m of expired) await closeMembership(q, m.clusterKey, m.listingId, now)
  const changed = await recomputeClusters(q, listingIds, now)
  const batches = chunk(changed, 500)
  const eventEnvelopes: EventEnvelope[] = []
  for (const batch of batches) {
    const key = await batchKey('copy-advert.clustered', batch)
    eventEnvelopes.push(
      createEvent(
        events,
        'copy-advert.clustered',
        1,
        { listingIds: batch, ruleVersion: RULE_VERSION },
        { key },
      ) as EventEnvelope,
    )
  }
  return { changedListingIds: changed, events: eventEnvelopes }
}

/** `seller-rights`: deletes every row these listings hold, then recomputes clusters they leave. */
export async function erase(q: Queryable, listingIds: string[]): Promise<void> {
  if (listingIds.length === 0) return
  const oldKeys = await selectActiveClusterKeys(q, listingIds)
  await eraseListings(q, listingIds)
  const clusterKeys = [...new Set(oldKeys.values())]
  for (const key of clusterKeys) {
    const remaining = await selectActiveMembers(q, [key])
    if (remaining.length < 2) await expireCluster(q, key)
  }
}

/** `account.deleted`: purges the user's report rows. */
export async function purgeUserReports(q: Queryable, userId: string): Promise<void> {
  await deleteReportsForUser(q, userId)
}

/**
 * A signed-in user's report that a listing's flag is a mistake. The caller (an oRPC procedure
 * inside `withUser`) has already checked the account's standing through `@nabvy/account`.
 */
export async function report(
  q: Queryable,
  userId: string,
  input: CopyAdvertReportInput,
): Promise<{ recorded: boolean }> {
  const parsed = CopyAdvertReportInputSchema.parse(input)
  const { inserted } = await insertReport(q, {
    userId,
    listingId: parsed.listingId,
    reason: parsed.reason,
    at: new Date(),
  })
  return { recorded: inserted }
}

/**
 * An admin correction, audited through `@nabvy/audit-log` in the same transaction. The next
 * recompute of the affected listings respects it (`overrides` table; not yet enforced inside
 * `recomputeClusters`, which is `review-console`'s follow-up — docs/questions/copy-advert.md).
 */
export async function applyCorrection(q: Queryable, input: CopyAdvertCorrection): Promise<void> {
  const parsed = CopyAdvertCorrectionSchema.parse(input)
  const at = new Date()
  const { id: auditId } = await record(q, {
    actorUserId: parsed.actorUserId,
    action: 'copy-advert.correction-applied',
    target: `listing:${parsed.listingA}`,
    after: { action: parsed.action, listingB: parsed.listingB ?? null, reason: parsed.reason },
    reason: parsed.reason,
  })
  await insertOverride(q, {
    kind: parsed.action,
    listingA: parsed.listingA,
    listingB: parsed.listingB ?? null,
    reason: parsed.reason,
    auditId,
    at,
  })
}
