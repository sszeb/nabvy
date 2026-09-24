import {
  ACCOUNT_REVIEW_OFFER,
  type AuthError,
  type AuthErrorCode,
  accountRestrictedNotice,
  REVIEW_WINDOW_DAYS,
  type RestrictionPolicy,
  type RestrictionStep,
} from '@nabvy/contracts/modules/auth'

/**
 * Raised by the session helpers. `status` is the HTTP status the web app answers with and
 * `toJSON()` is the whole of what reaches the browser (the `AuthError` contract).
 */
export class AuthFailure extends Error {
  readonly code: AuthErrorCode
  readonly status: 401 | 403

  constructor(code: AuthErrorCode, message: string, status: 401 | 403) {
    super(message)
    this.name = 'AuthFailure'
    this.code = code
    this.status = status
  }

  toJSON(): AuthError {
    return { code: this.code, message: this.message } as AuthError
  }
}

export class UnauthenticatedError extends AuthFailure {
  constructor() {
    super('auth.unauthenticated', 'Sign in to continue.', 401)
    this.name = 'UnauthenticatedError'
  }
}

export class ForbiddenError extends AuthFailure {
  constructor() {
    super('auth.forbidden', 'You do not have access to this.', 403)
    this.name = 'ForbiddenError'
  }
}

/**
 * A suspended or banned account. It takes only the step and the policy, both enumerations: the
 * message names them and nothing more, so no reason, rule, signal, score or date can be added.
 * The review route (`ACCOUNT_REVIEW_OFFER`) is shown with it.
 */
export class AccountRestrictedError extends AuthFailure {
  readonly step: RestrictionStep
  readonly policy: RestrictionPolicy
  readonly reviewOffer = ACCOUNT_REVIEW_OFFER

  constructor(step: RestrictionStep, policy: RestrictionPolicy) {
    super('auth.account_restricted', accountRestrictedNotice(step, policy), 403)
    this.name = 'AccountRestrictedError'
    this.step = step
    this.policy = policy
  }

  override toJSON(): AuthError {
    return {
      code: 'auth.account_restricted',
      message: this.message,
      step: this.step,
      policy: this.policy,
      reviewWithinDays: REVIEW_WINDOW_DAYS,
    }
  }
}

/** An admin action named an account that does not exist; nothing was changed or recorded. */
export class UnknownAccountError extends Error {
  constructor(readonly userId: string) {
    super('No account has this ID.')
    this.name = 'UnknownAccountError'
  }
}
