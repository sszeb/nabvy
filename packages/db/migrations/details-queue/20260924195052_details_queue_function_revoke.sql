-- Hardening (task 0.9d, convention checks): the CI check for a matching revoke on every
-- function found details_queue.batches_close_once() had none. New functions are executable by
-- PUBLIC by default; every other module's trigger functions already revoke it, this one missed it.
revoke all on function details_queue.batches_close_once() from public;
