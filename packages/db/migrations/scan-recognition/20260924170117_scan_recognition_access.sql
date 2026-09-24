-- scan-recognition: grants, RLS, views. Hand-written (packages/db/README.md).
comment on schema scan_recognition is
  'Scan recognition: identifies an item the user scanned. Owner: the scan-recognition module.';
grant usage on schema scan_recognition to nabvy_app, nabvy_pipeline;

-- scan_events: the scan itself runs as the pipeline (a Trigger.dev task the scan procedure starts,
-- docs/scan-mode.md, "On-demand fetch"), because it reads product-catalogue and writes cost-meter,
-- which only the pipeline may. It inserts the row, reads the user's spend for the cap, expires
-- photo refs after 30 days and purges a deleted account's rows. The user confirms or picks a
-- candidate on their own row through withUser: nabvy_app may update only the confirmation
-- columns; the check constraints keep `identified` one of `candidates`.
select nabvy_core.enable_user_rls('scan_recognition.scan_events');
grant select on scan_recognition.scan_events to nabvy_app;
grant update (status, identified, confirmed, identified_at, confirmed_at)
  on scan_recognition.scan_events to nabvy_app;
select nabvy_core.allow_pipeline('scan_recognition.scan_events', 'select');
select nabvy_core.allow_pipeline('scan_recognition.scan_events', 'insert');
select nabvy_core.allow_pipeline('scan_recognition.scan_events', 'update');
select nabvy_core.allow_pipeline('scan_recognition.scan_events', 'delete');
grant select, insert, update, delete on scan_recognition.scan_events to nabvy_pipeline;
select nabvy_core.track_updated_at('scan_recognition.scan_events');

-- Internal view (rule 5 of docs/design/modules/_rules.md): no photo ref, barcode, model output
-- or cost. Rows while the switch is shadow or on (rule 11). nabvy_pipeline only until per-module
-- roles exist (the stand-in switches and cost-meter use).
create view scan_recognition.v_scans with (security_invoker = true) as
  select id, user_id, method, status, identified, confidence, confirmed, model_called, at,
         identified_at
  from scan_recognition.scan_events
  where switches.state('scan-recognition') <> 'off';
revoke all on scan_recognition.v_scans from public;
grant select on scan_recognition.v_scans to nabvy_pipeline;

-- User-facing view: the user's own scans (RLS through security_invoker), only while the switch
-- is on (rule 11). An explicit column list: no user ID, photo ref, model output or cost. It lives
-- in this module's schema because no `app` schema exists yet (docs/questions/scan-recognition.md).
-- Not a listing view, so the suppression filter of rule 5 does not apply.
create view scan_recognition.v_user_scans with (security_invoker = true) as
  select id, method, status, identified, candidates, confidence, confirmed, search_phrases, at
  from scan_recognition.scan_events
  where switches.is_on('scan-recognition');
revoke all on scan_recognition.v_user_scans from public;
grant select on scan_recognition.v_user_scans to nabvy_app;
