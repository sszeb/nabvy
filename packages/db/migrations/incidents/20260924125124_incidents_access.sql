-- Access for the incidents schema (packages/db/README.md, "Adding tables to a module").
-- Incidents holds no user rows: a dead-lettered event is operational data, not user data, so
-- there is no user_id column and no RLS. The task wrapper writes as nabvy_pipeline when it
-- records a failure; an admin's retry runs inside the web app's oRPC procedures as nabvy_app.
-- Neither role gets delete: incidents are never removed, only resolved.

grant usage on schema incidents to nabvy_app, nabvy_pipeline;

grant select, insert, update on incidents.incidents to nabvy_pipeline;
grant select, update on incidents.incidents to nabvy_app;
select nabvy_core.track_updated_at('incidents.incidents');

-- The read interface for other modules and the admin console: security_invoker (a no-op today,
-- since this table has no RLS, but the standing rule for every v_ view) and only open
-- (unresolved) incidents.
create view incidents.v_open with (security_invoker = true) as
  select
    id, event_type, event_key, payload, error, attempts, first_failed_at, created_at, updated_at
  from incidents.incidents
  where resolved_at is null;
grant select on incidents.v_open to nabvy_app, nabvy_pipeline;
