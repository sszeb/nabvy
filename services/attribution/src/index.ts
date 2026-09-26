// Public API of the attribution module: the functions other modules and a future sign-up hook or
// oRPC procedure may call. Other modules import from '@nabvy/attribution' only, never its
// internals.
//
// Stripe data reaches this module as clean, already-verified parameters (`trackSale`,
// `reverseSale`), not a raw webhook: there is one Stripe webhook secret in the whole system
// (docs/secrets.md), owned by `subscriptions`, and this module never verifies a signature.
// Wiring a real caller into that webhook is follow-up work outside this module's own files
// (docs/questions/attribution.md). See README.md, "Decisions", for the rest of this module's
// scope choices: which "referred" pays a Dub commission and which grants the peer £5/£5.
import { isActive } from '@nabvy/account'
import { ATTRIBUTION_REFERRAL_CREDIT_CREDITS } from '@nabvy/config/modules/attribution'
import { err, ok, type Result, Uuid } from '@nabvy/contracts'
import {
  ATTRIBUTION_MESSAGES,
  AttributionCaptureInput,
  type AttributionCaptureInputRaw,
  type AttributionError,
  type AttributionErrorCode,
  AttributionRecord,
  AttributionReversalInput,
  AttributionSaleInput,
  type AttributionSaleInputRaw,
  type AttributionSaleResult,
} from '@nabvy/contracts/modules/attribution'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { grant as grantUsage } from '@nabvy/usage-ledger'
import { generateReferralCode, isSelfReferral, referralCreditRefId } from './domain'
import * as repo from './repo'

export { events, module } from '@nabvy/contracts/modules/attribution'
export { accountDeletedHandler } from './handlers'

const refuse = (code: AttributionErrorCode): Result<never, AttributionError> =>
  err({ code, message: ATTRIBUTION_MESSAGES[code] })

function toRecord(row: repo.AttributionRow): AttributionRecord {
  return AttributionRecord.parse({
    userId: row.userId,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmContent: row.utmContent,
    utmTerm: row.utmTerm,
    affiliateClickId: row.affiliateClickId,
    affiliateCode: row.affiliateCode,
    affiliatePartnerId: row.affiliatePartnerId,
    referralCode: row.referralCode,
    referredBy: row.referredBy,
    referredAt: row.referredAt?.toISOString() ?? null,
    creditedAt: row.creditedAt?.toISOString() ?? null,
    capturedAt: row.capturedAt.toISOString(),
  })
}

const sameCapture = (existing: repo.UtmAttributionRow, input: AttributionCaptureInput): boolean =>
  existing.utmSource === input.utmSource &&
  existing.utmMedium === input.utmMedium &&
  existing.utmCampaign === input.utmCampaign &&
  existing.utmContent === input.utmContent &&
  existing.utmTerm === input.utmTerm &&
  existing.affiliateClickId === input.affiliateClickId &&
  existing.affiliateCode === input.affiliateCode

// -------------------------------------------------------------------------------------------
// The injected partner platform (README.md, "Decisions"): Dub Partners is not an account yet, so
// every caller injects a client. The default is in-memory only; a real Dub HTTP client
// (DUB_API_KEY, DUB_PROGRAM_ID) is later work once that account exists.
// -------------------------------------------------------------------------------------------

export interface AttributionPartnerClient {
  /** Called once per user at sign-up when a click or a creator code is present. */
  trackLead(input: {
    userId: string
    affiliateClickId: string | null
    affiliateCode: string | null
  }): Promise<{ partnerId: string | null }>
  /** Called once per invoice already attributed to a partner. */
  trackSale(input: {
    userId: string
    partnerId: string
    invoiceId: string
    amountMinor: number
    currency: 'GBP'
    kind: 'subscription' | 'topup'
  }): Promise<{ saleId: string | null }>
  /** Claws back a tracked sale's commission. */
  reverseSale(input: {
    userId: string
    partnerId: string
    invoiceId: string | null
    reason: 'chargeback' | 'refund'
  }): Promise<void>
}

/**
 * A deterministic stand-in: a click ID or creator code always resolves to a partner, keyed by
 * itself, and every call is recorded so a test can assert on it. No network call, no state kept
 * beyond the call log (this module's own `partner_events` table is the real record).
 */
export function inMemoryPartnerClient(): AttributionPartnerClient {
  return {
    async trackLead({ affiliateClickId, affiliateCode }) {
      const partnerId = affiliateClickId ?? affiliateCode
      return { partnerId: partnerId ? `partner_${partnerId}` : null }
    },
    async trackSale({ partnerId, invoiceId }) {
      return { saleId: `sale_${partnerId}_${invoiceId}` }
    },
    async reverseSale() {},
  }
}

export interface AttributionDeps {
  partnerClient: AttributionPartnerClient
  /** `() => number in [0, 1)`; defaults to a CSPRNG (`domain.generateReferralCode`). */
  random?: () => number
}

function cryptoRandom(): number {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return (bytes[0] ?? 0) / 2 ** 32
}

async function issueReferralCode(
  q: Queryable,
  userId: string,
  random: () => number,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode(random)
    const inserted = await repo.insertReferralCode(q, userId, code)
    if (inserted) return inserted.code
  }
  throw new Error(`attribution: could not issue a unique referral code for ${userId}`)
}

/**
 * Captures sign-up attribution: UTM tags, a Dub click or creator code, and a peer's referral
 * code, and issues this user's own shareable code. Idempotent per user: a replay with the same
 * details returns the existing record unchanged; with different details it is refused
 * (`attribution.mismatch`). A self-referral is refused; an unknown referral code is dropped
 * (README.md, "Decisions") rather than failing sign-up over a bad parameter. Runs in the
 * pipeline (no user session exists yet at a sign-up hook).
 */
export async function captureAttribution(
  q: Queryable,
  input: AttributionCaptureInputRaw,
  deps: AttributionDeps,
): Promise<Result<AttributionRecord, AttributionError>> {
  const c = AttributionCaptureInput.parse(input)
  if ((await state(q, 'attribution')) === 'off') return refuse('attribution.off')
  await repo.lockUser(q, c.userId)

  const existingUtm = await repo.selectUtmAttribution(q, c.userId)
  if (existingUtm) {
    if (!sameCapture(existingUtm, c)) return refuse('attribution.mismatch')
    const row = await repo.selectAttribution(q, c.userId)
    if (!row)
      throw new Error(`attribution: ${c.userId} has utm_attributions but no v_attributions row`)
    return ok(toRecord(row))
  }

  let referrerUserId: string | null = null
  if (c.referralCode) {
    const owner = await repo.selectReferralCodeOwner(q, c.referralCode)
    if (owner) {
      if (isSelfReferral(owner, c.userId)) return refuse('attribution.self_referral')
      referrerUserId = owner
    }
  }

  const random = deps.random ?? cryptoRandom
  const inserted = await repo.insertUtmAttribution(q, {
    userId: c.userId,
    utmSource: c.utmSource,
    utmMedium: c.utmMedium,
    utmCampaign: c.utmCampaign,
    utmContent: c.utmContent,
    utmTerm: c.utmTerm,
    affiliateClickId: c.affiliateClickId,
    affiliateCode: c.affiliateCode,
  })
  if (!inserted) throw new Error(`attribution: sign-up ${c.userId} appeared under its lock`)
  await issueReferralCode(q, c.userId, random)
  if (referrerUserId) {
    await repo.insertReferral(q, {
      referrerUserId,
      referredUserId: c.userId,
      code: c.referralCode as string,
    })
  }

  if (c.affiliateClickId || c.affiliateCode) {
    const lead = await deps.partnerClient.trackLead({
      userId: c.userId,
      affiliateClickId: c.affiliateClickId,
      affiliateCode: c.affiliateCode,
    })
    await repo.insertPartnerEvent(q, {
      userId: c.userId,
      kind: 'lead',
      refId: 'signup',
      partnerId: lead.partnerId,
    })
    if (lead.partnerId) await repo.setAffiliatePartnerId(q, c.userId, lead.partnerId)
  }

  const row = await repo.selectAttribution(q, c.userId)
  if (!row)
    throw new Error(`attribution: ${c.userId} was just captured but has no v_attributions row`)
  return ok(toRecord(row))
}

/**
 * A paid invoice: tracks the sale with Dub when this user carries a partner attribution, and
 * credits the give-£5-get-£5 pair, once, when this user was referred by a peer and the pair is
 * not credited yet (`kind: 'subscription'` only — a top-up never triggers the pair, README.md,
 * "Decisions"). A user with no partner attribution and no referral pairing makes no calls at all.
 * Idempotent on the invoice ID for the Dub call, and on the pair for the credit (whichever
 * invoice reaches it first). Requires the switch `on`: a commission and a credit both move
 * money (rule 11), so `shadow` refuses (`attribution.not_on`) and records nothing.
 */
export async function trackSale(
  q: Queryable,
  input: AttributionSaleInputRaw,
  deps: AttributionDeps,
): Promise<Result<AttributionSaleResult, AttributionError>> {
  const s = AttributionSaleInput.parse(input)
  const switchState = await state(q, 'attribution')
  if (switchState === 'off') return refuse('attribution.off')
  if (switchState !== 'on') return refuse('attribution.not_on')
  if (!(await isActive(q, s.userId))) return refuse('attribution.account_inactive')
  await repo.lockUser(q, s.userId)

  const utm = await repo.selectUtmAttribution(q, s.userId)
  let trackedSale = false
  if (utm?.affiliatePartnerId) {
    const existing = await repo.selectPartnerEvent(q, s.userId, 'sale', s.invoiceId)
    if (!existing) {
      await deps.partnerClient.trackSale({
        userId: s.userId,
        partnerId: utm.affiliatePartnerId,
        invoiceId: s.invoiceId,
        amountMinor: s.amountMinor,
        currency: s.currency,
        kind: s.kind,
      })
      await repo.insertPartnerEvent(q, {
        userId: s.userId,
        kind: 'sale',
        refId: s.invoiceId,
        partnerId: utm.affiliatePartnerId,
        amountMinor: s.amountMinor,
        currency: s.currency,
      })
    }
    trackedSale = true
  }

  let creditedReferral = false
  if (s.kind === 'subscription') {
    const referral = await repo.selectReferralByReferred(q, s.userId)
    if (referral && !referral.creditedAt && (await isActive(q, referral.referrerUserId))) {
      const referrerGrant = await grantUsage(q, {
        userId: referral.referrerUserId,
        kind: 'referral',
        credits: ATTRIBUTION_REFERRAL_CREDIT_CREDITS,
        refId: referralCreditRefId('referrer', referral.id),
      })
      const referredGrant = await grantUsage(q, {
        userId: referral.referredUserId,
        kind: 'referral',
        credits: ATTRIBUTION_REFERRAL_CREDIT_CREDITS,
        refId: referralCreditRefId('referred', referral.id),
      })
      if (referrerGrant.ok && referredGrant.ok) {
        await repo.markReferralCredited(q, referral.id, new Date())
        creditedReferral = true
      }
    }
  }

  return ok({ trackedSale, creditedReferral })
}

/**
 * A dispute or a legally required refund on a previously tracked sale: claws back the Dub
 * commission only (README.md, "Decisions" — a referral credit already granted is never reversed;
 * no refund path exists anywhere, `docs/decisions.md`, "No refunds"). A user with no partner
 * attribution makes no call. Idempotent on the Stripe dispute or refund event ID. Like
 * `trackSale`, requires the switch `on` (rule 11: it moves money); `shadow` refuses.
 */
export async function reverseSale(
  q: Queryable,
  input: AttributionReversalInput,
  deps: AttributionDeps,
): Promise<Result<{ reversed: boolean }, AttributionError>> {
  const r = AttributionReversalInput.parse(input)
  const switchState = await state(q, 'attribution')
  if (switchState === 'off') return refuse('attribution.off')
  if (switchState !== 'on') return refuse('attribution.not_on')
  await repo.lockUser(q, r.userId)

  const utm = await repo.selectUtmAttribution(q, r.userId)
  if (!utm?.affiliatePartnerId) return ok({ reversed: false })
  const existing = await repo.selectPartnerEvent(q, r.userId, 'reversal', r.stripeEventId)
  if (existing) return ok({ reversed: true })

  await deps.partnerClient.reverseSale({
    userId: r.userId,
    partnerId: utm.affiliatePartnerId,
    invoiceId: null,
    reason: r.reason,
  })
  await repo.insertPartnerEvent(q, {
    userId: r.userId,
    kind: 'reversal',
    refId: r.stripeEventId,
    partnerId: utm.affiliatePartnerId,
    reason: r.reason,
  })
  return ok({ reversed: true })
}

/**
 * A user's own attribution record (their referral code, and who referred them), for the account
 * page. `null` for a user never captured (created before this module, or a failed capture).
 * Refused while the module is off: rule 11, no exception is named for this module.
 */
export async function getAttribution(
  q: Queryable,
  userId: string,
): Promise<Result<AttributionRecord | null, AttributionError>> {
  Uuid.parse(userId)
  if ((await state(q, 'attribution')) === 'off') return refuse('attribution.off')
  const row = await repo.selectAttribution(q, userId)
  return ok(row ? toRecord(row) : null)
}

/**
 * Erases every row this module holds for these users, on `account.deleted` (rule 12). Runs
 * whatever the switch says: a retention deadline, not a feature. Idempotent.
 */
export async function purge(q: Queryable, userIds: readonly string[]): Promise<{ users: number }> {
  for (const id of userIds) Uuid.parse(id)
  return { users: await repo.purgeUsers(q, userIds) }
}
