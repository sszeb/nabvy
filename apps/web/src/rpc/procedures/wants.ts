import {
  WantManagerDeleteWantInput,
  WantManagerSetActiveInput,
  WantManagerUpsertWantInput,
} from '@nabvy/contracts/modules/want-manager'
import { withUser } from '@nabvy/db'
import {
  deleteWant as deleteWantFn,
  listWants as listWantsFn,
  previewWant as previewWantFn,
  setActive as setActiveFn,
  upsertWant as upsertWantFn,
} from '@nabvy/want-manager'
import { userProcedure } from '../context'

// Every want-manager write and read runs inside `withUser(userId)`, as `nabvy_app`: RLS is the
// only isolation a caller needs (services/want-manager/README.md). The client never sends its
// own userId; it comes from the session the middleware already resolved.

const UpsertWantClientInput = WantManagerUpsertWantInput.omit({ userId: true })
const SetActiveClientInput = WantManagerSetActiveInput.omit({ userId: true })
const DeleteWantClientInput = WantManagerDeleteWantInput.omit({ userId: true })

export const upsertWant = userProcedure
  .input(UpsertWantClientInput)
  .handler(({ input, context }) =>
    withUser(context.user.id, (tx) => upsertWantFn(tx, { ...input, userId: context.user.id })),
  )

export const setActive = userProcedure
  .input(SetActiveClientInput)
  .handler(({ input, context }) =>
    withUser(context.user.id, (tx) => setActiveFn(tx, { ...input, userId: context.user.id })),
  )

export const deleteWant = userProcedure
  .input(DeleteWantClientInput)
  .handler(({ input, context }) =>
    withUser(context.user.id, (tx) => deleteWantFn(tx, { ...input, userId: context.user.id })),
  )

export const listWants = userProcedure.handler(({ context }) =>
  withUser(context.user.id, (tx) => listWantsFn(tx, context.user.id)),
)

export const previewWant = userProcedure
  .input(UpsertWantClientInput)
  .handler(({ input, context }) =>
    withUser(context.user.id, (tx) => previewWantFn(tx, { ...input, userId: context.user.id })),
  )
