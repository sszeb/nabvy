import { z } from 'zod'

/**
 * Expected failures are values, not exceptions (docs/engineering.md, "Errors"). Error codes are
 * owned by the module that raises them and prefixed with its name, `<module>.<code>`, so modules
 * add codes in their own contract file without a shared enum.
 */
export const ErrorCode = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9_]*$/)
export type ErrorCode = z.infer<typeof ErrorCode>

export const AppError = z.strictObject({ code: ErrorCode, message: z.string() })
export type AppError = z.infer<typeof AppError>

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
