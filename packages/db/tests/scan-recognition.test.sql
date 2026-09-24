-- scan-recognition: grants, RLS isolation, the scan constraints and the views. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
begin
  -- The pipeline runs scans, expiry and the account purge; the web app reads its own rows and
  -- writes only the confirmation columns.
  if not (has_table_privilege('nabvy_pipeline', 'scan_recognition.scan_events', 'select')
          and has_table_privilege('nabvy_pipeline', 'scan_recognition.scan_events', 'insert')
          and has_table_privilege('nabvy_pipeline', 'scan_recognition.scan_events', 'update')
          and has_table_privilege('nabvy_pipeline', 'scan_recognition.scan_events', 'delete')) then
    raise exception 'nabvy_pipeline lacks its scan_events grants';
  end if;
  if has_table_privilege('nabvy_app', 'scan_recognition.scan_events', 'insert')
     or has_table_privilege('nabvy_app', 'scan_recognition.scan_events', 'delete')
     or has_column_privilege('nabvy_app', 'scan_recognition.scan_events', 'cost_gbp_micros', 'update')
     or has_column_privilege('nabvy_app', 'scan_recognition.scan_events', 'candidates', 'update')
     or has_column_privilege('nabvy_app', 'scan_recognition.scan_events', 'confidence', 'update') then
    raise exception 'nabvy_app can write more than the confirmation columns';
  end if;
  if not has_column_privilege('nabvy_app', 'scan_recognition.scan_events', 'identified', 'update') then
    raise exception 'nabvy_app cannot confirm a scan';
  end if;
  -- Views: the internal one to the pipeline only, the user-facing one to the web app only.
  if not has_table_privilege('nabvy_pipeline', 'scan_recognition.v_scans', 'select')
     or has_table_privilege('nabvy_app', 'scan_recognition.v_scans', 'select') then
    raise exception 'v_scans grants are wrong';
  end if;
  if not has_table_privilege('nabvy_app', 'scan_recognition.v_user_scans', 'select')
     or has_table_privilege('nabvy_pipeline', 'scan_recognition.v_user_scans', 'select') then
    raise exception 'v_user_scans grants are wrong';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'scan_recognition' and table_name = 'v_user_scans')
     is distinct from array['id', 'method', 'status', 'identified', 'candidates', 'confidence',
                            'confirmed', 'search_phrases', 'at'] then
    raise exception 'v_user_scans has other columns than the allowed list';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'scan_recognition', 'usage') then
      raise exception '% can use schema scan_recognition', r;
    end if;
  end loop;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'scan_recognition.%') then
    raise exception 'a scan_recognition view breaks the view rules';
  end if;
end;
$$;

-- Constraints: identified is always a candidate; statuses stay consistent; photos sit under the
-- user's own path.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into scan_recognition.scan_events (id, user_id, method, status, identified, candidates, at) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 'vision', 'identified', 'gpu:nvidia:rtx-3090:24gb', '{gpu:nvidia:rtx-3080:10gb}', now())$q$,
    $q$insert into scan_recognition.scan_events (id, user_id, method, status, identified, candidates, at) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 'vision', 'needs_confirmation', 'gpu:nvidia:rtx-3080:10gb', '{gpu:nvidia:rtx-3080:10gb}', now())$q$,
    $q$insert into scan_recognition.scan_events (id, user_id, method, status, at) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 'vision', 'needs_confirmation', now())$q$,
    $q$insert into scan_recognition.scan_events (id, user_id, photo_ref, method, status, at) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 'scans/00000000-0000-4000-8000-0000000000b2/x.jpg', 'none', 'unidentified', now())$q$,
    $q$insert into scan_recognition.scan_events (id, user_id, method, status, cost_gbp_micros, at) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 'none', 'unidentified', 10, now())$q$
  ] loop
    refused := false;
    begin
      execute probe;
    exception when check_violation then
      refused := true;
    end;
    if not refused then
      raise exception 'constraint did not refuse: %', probe;
    end if;
  end loop;
end;
$$;

-- RLS: a user sees only their own scans through v_user_scans, and only while the switch is on.
insert into switches.switches (name, kind, state) values ('scan-recognition', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into scan_recognition.scan_events (id, user_id, method, status, identified, candidates, confidence, at)
values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'barcode', 'identified', 'gpu:nvidia:rtx-3080:10gb', '{gpu:nvidia:rtx-3080:10gb}', 1, now()),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2', 'barcode', 'identified', 'gpu:nvidia:rtx-3080:10gb', '{gpu:nvidia:rtx-3080:10gb}', 1, now());

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select count(*) from scan_recognition.v_user_scans) <> 1
     or not exists (select 1 from scan_recognition.v_user_scans where id = '00000000-0000-4000-8000-0000000000c1') then
    raise exception 'v_user_scans does not show exactly the user''s own scan';
  end if;
  -- RLS on the base table: another user's row is neither visible nor updatable.
  if exists (select 1 from scan_recognition.scan_events where id = '00000000-0000-4000-8000-0000000000c2') then
    raise exception 'nabvy_app can see another user''s scan';
  end if;
  update scan_recognition.scan_events set confirmed = true
    where id = '00000000-0000-4000-8000-0000000000c2';
  if found then
    raise exception 'nabvy_app updated another user''s scan';
  end if;
end;
$$;
-- Column grants: model, barcode and photo columns are refused even on the user's own row.
do $$
declare
  probe text;
  refused boolean;
begin
  foreach probe in array array[
    $q$update scan_recognition.scan_events set model_ref = 'x' where id = '00000000-0000-4000-8000-0000000000c1'$q$,
    $q$update scan_recognition.scan_events set barcode = '12345678' where id = '00000000-0000-4000-8000-0000000000c1'$q$,
    $q$update scan_recognition.scan_events set photo_ref = null where id = '00000000-0000-4000-8000-0000000000c1'$q$
  ] loop
    refused := false;
    begin
      execute probe;
    exception when insufficient_privilege then
      refused := true;
    end;
    if not refused then
      raise exception 'nabvy_app was allowed: %', probe;
    end if;
  end loop;
end;
$$;
reset role;

update switches.switches set state = 'shadow' where name = 'scan-recognition';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from scan_recognition.v_user_scans) then
    raise exception 'v_user_scans shows rows while the module is in shadow';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'off' where name = 'scan-recognition';
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from scan_recognition.v_scans) then
    raise exception 'v_scans shows rows while the module is off';
  end if;
end;
$$;
reset role;

rollback;
