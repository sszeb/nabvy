import {
  ACCOUNT_RESTRICTED_MESSAGE,
  type AuthError,
  type AuthErrorCode,
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
 * A suspended or banned account. It takes no arguments on purpose: the message is always the
 * vague notice, and no reason, rule, signal, score or date can be attached to it.
 */
export class AccountRestrictedError extends AuthFailure {
  constructor() {
    super('auth.account_restricted', ACCOUNT_RESTRICTED_MESSAGE, 403)
    this.name = 'AccountRestrictedError'
  }
}
