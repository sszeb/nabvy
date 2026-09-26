-- pickup-routes: grants and RLS. Hand-written (packages/db/README.md). Depends on core (uuidv7,
-- track_updated_at, RLS and pipeline helpers) and switches (the module's switch is read in
-- application code; no SQL object here references switches.*, but the module cannot run without
-- it). No view: by the owner's decision (docs/decisions.md:174; docs/design/modules/
-- pickup-routes.md, "Views: none") a user's pickups, days, plans and defaults appear in no v_
-- view, and packages/db/tests/pickup-routes.test.sql fails if one ever exists. The private
-- columns (private_enc) hold AES-256-GCM sealed blobs under PICKUPS_DATA_KEY; the pipeline role
-- is never granted them.
comment on schema pickup_routes is
  'Pickup routes: a user''s own arranged pickups, pickup days, reminders and route plans. Owner: the pickup-routes module.';
grant usage on schema pickup_routes to nabvy_app, nabvy_pipeline;

-- pickups: written entirely by the web app inside withUser (services/pickup-routes/src/index.ts);
-- the user may delete their own. The pipeline reads only the plain columns a reminder needs
-- (label, day, window, status) and never the sealed blob, and deletes for the account.deleted
-- purge and the retention job (rule 12 of docs/design/modules/_rules.md; §5.6).
select nabvy_core.enable_user_rls('pickup_routes.pickups');
grant select, insert, update, delete on pickup_routes.pickups to nabvy_app;
select nabvy_core.allow_pipeline('pickup_routes.pickups', 'select');
select nabvy_core.allow_pipeline('pickup_routes.pickups', 'delete');
grant select (id, user_id, label, day, window_kind, window_start, window_end, status, created_at, updated_at)
  on pickup_routes.pickups to nabvy_pipeline;
grant delete on pickup_routes.pickups to nabvy_pipeline;
select nabvy_core.track_updated_at('pickup_routes.pickups');

-- pickup_reminders: scheduled by the web app inside withUser when a pickup or plan changes;
-- read, marked sent and purged by the pipeline (the dispatcher's due scan).
select nabvy_core.enable_user_rls('pickup_routes.pickup_reminders');
grant select, insert, update, delete on pickup_routes.pickup_reminders to nabvy_app;
select nabvy_core.allow_pipeline('pickup_routes.pickup_reminders', 'select');
select nabvy_core.allow_pipeline('pickup_routes.pickup_reminders', 'update');
select nabvy_core.allow_pipeline('pickup_routes.pickup_reminders', 'delete');
grant select, delete on pickup_routes.pickup_reminders to nabvy_pipeline;
grant update (sent_at) on pickup_routes.pickup_reminders to nabvy_pipeline;
select nabvy_core.track_updated_at('pickup_routes.pickup_reminders');

-- pickup_days and route_plans: the web app's alone, inside withUser; the pipeline only purges.
select nabvy_core.enable_user_rls('pickup_routes.pickup_days');
grant select, insert, update, delete on pickup_routes.pickup_days to nabvy_app;
select nabvy_core.allow_pipeline('pickup_routes.pickup_days', 'select');
select nabvy_core.allow_pipeline('pickup_routes.pickup_days', 'delete');
grant select (id, user_id, day, created_at, updated_at) on pickup_routes.pickup_days to nabvy_pipeline;
grant delete on pickup_routes.pickup_days to nabvy_pipeline;
select nabvy_core.track_updated_at('pickup_routes.pickup_days');

select nabvy_core.enable_user_rls('pickup_routes.route_plans');
grant select, insert, update, delete on pickup_routes.route_plans to nabvy_app;
select nabvy_core.allow_pipeline('pickup_routes.route_plans', 'select');
select nabvy_core.allow_pipeline('pickup_routes.route_plans', 'delete');
grant select (id, user_id, day_id, created_at, updated_at) on pickup_routes.route_plans to nabvy_pipeline;
grant delete on pickup_routes.route_plans to nabvy_pipeline;
select nabvy_core.track_updated_at('pickup_routes.route_plans');

-- planner_defaults: one row per user, the web app's alone; the pipeline only purges.
select nabvy_core.enable_user_rls('pickup_routes.planner_defaults');
grant select, insert, update, delete on pickup_routes.planner_defaults to nabvy_app;
select nabvy_core.allow_pipeline('pickup_routes.planner_defaults', 'select');
select nabvy_core.allow_pipeline('pickup_routes.planner_defaults', 'delete');
grant select (id, user_id, created_at, updated_at) on pickup_routes.planner_defaults to nabvy_pipeline;
grant delete on pickup_routes.planner_defaults to nabvy_pipeline;
select nabvy_core.track_updated_at('pickup_routes.planner_defaults');
