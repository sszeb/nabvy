import { WantManagerPreferences } from '@nabvy/contracts/modules/want-manager'
import { withUser } from '@nabvy/db'
import {
  getPreferences as getPreferencesFn,
  setPreferences as setPreferencesFn,
} from '@nabvy/want-manager'
import { userProcedure } from '../context'

const SetPreferencesClientInput = WantManagerPreferences.omit({ userId: true })

export const getPreferences = userProcedure.handler(({ context }) =>
  withUser(context.user.id, (tx) => getPreferencesFn(tx, context.user.id)),
)

export const setPreferences = userProcedure
  .input(SetPreferencesClientInput)
  .handler(({ input, context }) =>
    withUser(context.user.id, (tx) => setPreferencesFn(tx, { ...input, userId: context.user.id })),
  )
