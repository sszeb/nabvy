// Public API of the auth module. Other modules and apps/web import from '@nabvy/auth' only.
export {
  ACCOUNT_RESTRICTED_MESSAGE,
  AuthError,
  AuthErrorCode,
  events,
  module,
  Role,
} from '@nabvy/contracts/modules/auth'
export { type Auth, type AuthDatabase, type AuthOptions, createAuth } from './auth'
export {
  AccountRestrictedError,
  AuthFailure,
  ForbiddenError,
  isRestricted,
  UnauthenticatedError,
} from './domain'
export {
  createRecordingMagicLinkSender,
  createResendMagicLinkSender,
  type MagicLink,
  type MagicLinkSender,
  type RecordingMagicLinkSender,
} from './email/magic-link'
export { createAuthFromEnv, getAuth } from './instance'
export { assertAccountActive, isAccountActive } from './repo'
export { createAuthRouteHandlers } from './route-handler'
export {
  getSession,
  requireActiveUser,
  requireAdmin,
  requireUser,
  type SignedIn,
} from './session'
