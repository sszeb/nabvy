-- lifecycle-messaging: grants, RLS and the internal view. Hand-written (packages/db/README.md).
comment on schema lifecycle_messaging is
  'Behaviour-triggered messages sent through PostHog Workflows and Resend. Owner: the lifecycle-messaging module.';
grant usage on schema lifecycle_messaging to nabvy_pipeline;

-- programme_runs is written only from a pipeline context (the scheduled scan of
-- product_events.v_events and the account.deleted purge handler): no user session ever writes or
-- reads it directly, so nabvy_app has no grant at all (services/lifecycle-messaging/README.md,
-- "Decisions" -- there is no user-facing feature reading "messages sent to me" yet). It still
-- carries user_id, so it still gets row-level security (packages/db/README.md, "Every table
-- carrying a user_id gets enable_user_rls"); the pipeline is the only role ever granted on it, so
-- the policy's practical effect today is only to stop a future nabvy_app grant from leaking every
-- user's rows by default.
select nabvy_core.enable_user_rls('lifecycle_messaging.programme_runs');
select nabvy_core.allow_pipeline('lifecycle_messaging.programme_runs', 'select');
select nabvy_core.allow_pipeline('lifecycle_messaging.programme_runs', 'insert');
grant select, insert on lifecycle_messaging.programme_runs to nabvy_pipeline;
-- Runs are a record of what was actually sent: no role may update or delete a row (the account.deleted
-- purge handler is the one exception, granted delete for that purge only).
select nabvy_core.allow_pipeline('lifecycle_messaging.programme_runs', 'delete');
grant delete on lifecycle_messaging.programme_runs to nabvy_pipeline;

-- The internal read interface (rule 5 of docs/design/modules/_rules.md): every run, while the
-- module's switch is not off (rule 11). Granted to nabvy_pipeline until a module declares
-- lifecycle-messaging as a dependency and gets its own role (packages/db/README.md, "One Postgres
-- schema per module"). security_invoker checks the reader's own privileges against the base
-- table, so nabvy_pipeline needs SELECT on programme_runs directly, not only the view.
create view lifecycle_messaging.v_runs with (security_invoker = true) as
  select user_id, programme, step, triggered_at, at
  from lifecycle_messaging.programme_runs
  where switches.state('lifecycle-messaging') <> 'off';
revoke all on lifecycle_messaging.v_runs from public;
grant select on lifecycle_messaging.v_runs to nabvy_pipeline;
