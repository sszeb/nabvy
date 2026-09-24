// Public API of the auth module. Other modules and apps/web import from '@nabvy/auth' only.
export {
  ACCOUNT_REVIEW_OFFER,
  AuthError,
  AuthErrorCode,
  accountRestrictedNotice,
  events,
  module,
  POLICY_NAMES,
  REVIEW_WINDOW_DAYS,
  RestrictionPolicy,
  RestrictionStep,
  Role,
} from '@nabvy/contracts/modules/auth'
export { type Auth, type AuthDatabase, type AuthOptions, createAuth } from './auth'
export {
  AccountRestrictedError,
  AuthFailure,
  ForbiddenError,
  isRestricted,
  restrictionOf,
  UnauthenticatedError,
} from './domain'
export {
  createRecordingMagicLinkSender,
  createResendMagicLinkSender,
  type MagicLink,
  type MagicLinkSender,
  magicLinkText,
  type RecordingMagicLinkSender,
} from './email/magic-link'
export { createAuthFromEnv, getAuth } from './instance'
export { assertAccountActive, isAccountActive } from './repo'
export { liftRestriction, restrictAccount } from './restrict'
export { createAuthRouteHandlers } from './route-handler'
export {
  getSession,
  requireActiveUser,
  requireAdmin,
  requireUser,
  type SignedIn,
} from './session'
