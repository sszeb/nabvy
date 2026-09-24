-- Audited admin actions (task 4.0b; services/auth/README.md, "Admin actions"). Hand-written
-- (drizzle-kit --custom).
--
-- Every role change and admin action writes audit_log in the same transaction as the change
-- (docs/security.md). Only nabvy_auth can write better_auth.user and better_auth.session, so the
-- auth module's admin functions run on its connection and need to insert the audit row there.
-- Insert only: no select, update or delete (the table's triggers refuse the last two anyway).
-- The actor must be an existing account; the auth module names the admin whose session it checked.
grant usage on schema audit_log to nabvy_auth;
grant insert on audit_log.entries to nabvy_auth;
drop policy if exists auth_insert on audit_log.entries;
create policy auth_insert on audit_log.entries for insert to nabvy_auth
  with check (exists (select 1 from better_auth."user" u where u.id = actor_user_id));
