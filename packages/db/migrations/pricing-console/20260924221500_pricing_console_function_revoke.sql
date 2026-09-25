-- Hardening (task 0.9d, convention checks): the CI check for a matching revoke on every function
-- found pricing_console.guard_policy_rows() and pricing_console.refuse_truncate() had none. New
-- functions are executable by PUBLIC by default; every other function in this module already
-- revokes it, these two trigger functions missed it.
revoke all on function pricing_console.guard_policy_rows() from public;
revoke all on function pricing_console.refuse_truncate() from public;
