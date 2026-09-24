// Database access. Better Auth's tables (schema better_auth) are reached only through Better
// Auth itself; this module reads account standing through better_auth.account_active.
export { assertAccountActive, isAccountActive } from './standing'
