// Public API of the listing-feedback module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/listing-feedback' only, never from its internals. It records
// a user's verdict on a listing (real_deal, not_a_deal, bought) and their saved/dismissed state
// (README.md). Both run entirely inside withUser, as nabvy_app: row-level security is the only
// isolation a caller needs.
import { isActive } from '@nabvy/account'
import { createEvent, type EventEnvelope, err, ok, type Result } from '@nabvy/contracts'
import {
  events,
  type ListingFeedbackError,
  ListingFeedbackRecordVerdictInput,
  ListingFeedbackSetStateInput,
} from '@nabvy/contracts/modules/listing-feedback'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { recordedKey } from './domain'
import { type StateRow, upsertState, upsertVerdict, type VerdictRow } from './repo'

export { events, module } from '@nabvy/contracts/modules/listing-feedback'
export { onAccountDeleted } from './handlers'

export interface RecordVerdictOutcome {
  verdictId: string
  /** Whether this call wrote a new row (false: the identity already had this exact verdict). */
  created: boolean
  /** `listing-feedback.recorded`, for the caller to publish after its transaction commits. */
  event: EventEnvelope
}

export interface SetStateOutcome {
  stateId: string
  created: boolean
}

/**
 * Records a verdict for a listing (docs/design/modules/listing-feedback.md): `real_deal`,
 * `not_a_deal` or `bought`, optionally tied to the alert it came from. Safe to run twice: the
 * same verdict for the same listing (and alert, if any) writes one row and republishes the same
 * event key, which the transport drops. The `alert_feedback` analytics event is recorded by the
 * calling procedure through `product-events`, not here (README.md, "Decisions").
 */
export async function recordVerdict(
  q: Queryable,
  rawInput: ListingFeedbackRecordVerdictInput,
  options: { now?: Date } = {},
): Promise<Result<RecordVerdictOutcome, ListingFeedbackError>> {
  const parsed = ListingFeedbackRecordVerdictInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'listing-feedback.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  if ((await state(q, 'listing-feedback')) === 'off') {
    return err({ code: 'listing-feedback.off', message: 'Feedback is unavailable.' })
  }
  if (!(await isActive(q, input.userId))) {
    return err({
      code: 'listing-feedback.account_restricted',
      message: 'The account may not give feedback right now.',
    })
  }
  const { row, created } = await upsertVerdict(q, {
    userId: input.userId,
    listingId: input.listingId,
    alertId: input.alertId ?? null,
    verdict: input.verdict,
    at: options.now ?? new Date(),
  })
  return ok({
    verdictId: row.id,
    created,
    event: eventOf(row),
  })
}

/**
 * Saves or dismisses a listing. Safe to run twice: the same state for a listing writes one row.
 * Unlike a verdict, a state change publishes no event (README.md, "Decisions").
 */
export async function setState(
  q: Queryable,
  rawInput: ListingFeedbackSetStateInput,
  options: { now?: Date } = {},
): Promise<Result<SetStateOutcome, ListingFeedbackError>> {
  const parsed = ListingFeedbackSetStateInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'listing-feedback.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  if ((await state(q, 'listing-feedback')) === 'off') {
    return err({ code: 'listing-feedback.off', message: 'Feedback is unavailable.' })
  }
  if (!(await isActive(q, input.userId))) {
    return err({
      code: 'listing-feedback.account_restricted',
      message: 'The account may not give feedback right now.',
    })
  }
  const { row, created } = await upsertState(q, {
    userId: input.userId,
    listingId: input.listingId,
    state: input.state,
    at: options.now ?? new Date(),
  })
  return ok({ stateId: row.id, created })
}

function eventOf(row: VerdictRow): EventEnvelope {
  return createEvent(
    events,
    'listing-feedback.recorded',
    1,
    { verdictIds: [row.id] },
    { key: recordedKey(row.id, row.verdict) },
  ) as EventEnvelope
}

export type { StateRow, VerdictRow }
