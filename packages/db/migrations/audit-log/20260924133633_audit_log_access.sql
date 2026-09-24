-- audit-log: ownership, append-only enforcement, grants and the admin view. Hand-written.
comment on schema audit_log is
  'Audit log: one append-only row per human or admin action. Owner: the audit-log module. Internal; not exposed to the Data API.';
revoke all on schema audit_log from public;
revoke all on audit_log.entries from public;

-- Append-only. No role is granted update, delete or truncate, and these triggers refuse all three
-- even for the table owner, so a row can only be removed by dropping the trigger in a reviewed
-- migration.
create or replace function audit_log.refuse_change() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'audit_log.entries is append-only: % refused', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function audit_log.refuse_change() from public;

create trigger entries_append_only
  before update or delete on audit_log.entries
  for each row execute function audit_log.refuse_change();
create trigger entries_no_truncate
  before truncate on audit_log.entries
  for each statement execute function audit_log.refuse_change();

-- Writers. The web app records as the signed-in actor only: inside withUser(userId), a row
-- whose actor is anyone else is refused. The pipeline records admin actions run as tasks.
-- Neither can read the table back (no select grant, no select policy), so ids are made in code.
grant usage on schema audit_log to nabvy_app, nabvy_pipeline;
grant insert on audit_log.entries to nabvy_app, nabvy_pipeline;
alter table audit_log.entries enable row level security;
create policy app_insert_own on audit_log.entries for insert to nabvy_app
  with check (actor_user_id = nabvy_core.current_user_id());
select nabvy_core.allow_pipeline('audit_log.entries', 'insert');

-- The admin read interface. security_invoker, so RLS and grants apply to the reader. Granted to
-- no application role yet: admins read it through the admin screen once it and its role exist
-- (docs/questions.md), and developers read it as the migration role.
create view audit_log.v_entries with (security_invoker = true) as
  select id, actor_user_id, action, target, before, after, reason, at from audit_log.entries;
revoke all on audit_log.v_entries from public;
