import {
  exportAccount as exportAccountFn,
  getProfile as getProfileFn,
  getStanding as getStandingFn,
  requestDeletion as requestDeletionFn,
  updateProfile as updateProfileFn,
} from '@nabvy/account'
import { withUser } from '@nabvy/db'
import { z } from 'zod'
import { userProcedure } from '../context'

// `AccountUpdateProfileInput` (packages/contracts/src/modules/account.ts) carries a `.refine()`,
// which Zod 4 does not allow `.omit()` on, so the client-facing shape is declared separately here
// rather than derived from it; `updateProfile()` still receives the same two fields plus userId.
const UpdateProfileClientInput = z
  .strictObject({
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    analyticsConsent: z.boolean().optional(),
  })
  .refine((input) => input.displayName !== undefined || input.analyticsConsent !== undefined, {
    message: 'nothing to update',
  })

export const getProfile = userProcedure.handler(({ context }) =>
  withUser(context.user.id, (tx) => getProfileFn(tx, context.user.id)),
)

export const updateProfile = userProcedure
  .input(UpdateProfileClientInput)
  .handler(({ input, context }) =>
    withUser(context.user.id, (tx) => updateProfileFn(tx, { ...input, userId: context.user.id })),
  )

/** The signed-in user's own standing (`account.v_standing` is exempt from the module switch, so
 * this reads even while `account` is off — README.md, "Switch and priority"). */
export const getStanding = userProcedure.handler(({ context }) =>
  withUser(context.user.id, (tx) => getStandingFn(tx, context.user.id)),
)

export const exportAccount = userProcedure.handler(({ context }) =>
  withUser(context.user.id, (tx) => exportAccountFn(tx, { userId: context.user.id })),
)

export const requestDeletion = userProcedure.handler(({ context }) =>
  withUser(context.user.id, (tx) => requestDeletionFn(tx, { userId: context.user.id })),
)
