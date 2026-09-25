-- listing-feedback: grants, RLS isolation, the switch filter and the views. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
begin
  -- The web app writes its own rows entirely inside withUser; the pipeline only reads (for the
  -- internal views) and deletes (the account.deleted purge).
  if not (has_table_privilege('nabvy_app', 'listing_feedback.verdicts', 'select')
          and has_table_privilege('nabvy_app', 'listing_feedback.verdicts', 'insert')
          and has_table_privilege('nabvy_app', 'listing_feedback.verdicts', 'update')) then
    raise exception 'nabvy_app lacks its verdicts grants';
  end if;
  if has_table_privilege('nabvy_app', 'listing_feedback.verdicts', 'delete') then
    raise exception 'nabvy_app can delete verdicts';
  end if;
  if not (has_table_privilege('nabvy_pipeline', 'listing_feedback.verdicts', 'select')
          and has_table_privilege('nabvy_pipeline', 'listing_feedback.verdicts', 'delete')) then
    raise exception 'nabvy_pipeline lacks its verdicts purge grants';
  end if;
  if has_table_privilege('nabvy_pipeline', 'listing_feedback.verdicts', 'insert') then
    raise exception 'nabvy_pipeline can insert verdicts (writes must go through withUser)';
  end if;
  if not (has_table_privilege('nabvy_app', 'listing_feedback.listing_state', 'select')
          and has_table_privilege('nabvy_app', 'listing_feedback.listing_state', 'insert')
          and has_table_privilege('nabvy_app', 'listing_feedback.listing_state', 'update')) then
    raise exception 'nabvy_app lacks its listing_state grants';
  end if;

  -- Views: the two internal ones to the pipeline only, the user-facing one to the web app only.
  if not has_table_privilege('nabvy_pipeline', 'listing_feedback.v_verdict_counts', 'select')
     or has_table_privilege('nabvy_app', 'listing_feedback.v_verdict_counts', 'select') then
    raise exception 'v_verdict_counts grants are wrong';
  end if;
  if not has_table_privilege('nabvy_pipeline', 'listing_feedback.v_bought_for_reports', 'select')
     or has_table_privilege('nabvy_app', 'listing_feedback.v_bought_for_reports', 'select') then
    raise exception 'v_bought_for_reports grants are wrong';
  end if;
  if not has_table_privilege('nabvy_app', 'listing_feedback.v_listing_feedback_mine', 'select')
     or has_table_privilege('nabvy_pipeline', 'listing_feedback.v_listing_feedback_mine', 'select') then
    raise exception 'v_listing_feedback_mine grants are wrong';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'listing_feedback' and table_name = 'v_listing_feedback_mine')
     is distinct from array['listing_id', 'alert_id', 'verdict', 'state', 'at'] then
    raise exception 'v_listing_feedback_mine has other columns than the allowed list';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'listing_feedback' and table_name = 'v_verdict_counts')
     is distinct from array['alert_id', 'day', 'verdict', 'n'] then
    raise exception 'v_verdict_counts has other columns than the allowed list';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'listing_feedback', 'usage') then
      raise exception '% can use schema listing_feedback', r;
    end if;
  end loop;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'listing_feedback.%') then
    raise exception 'a listing_feedback view breaks the view rules';
  end if;
end;
$$;

-- Constraints: a verdict and a state are only their allowed values; alert_id may never be the nil
-- sentinel the identity index folds a null alert_id into.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into listing_feedback.verdicts (user_id, listing_id, verdict, at) values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'maybe', now())$q$,
    $q$insert into listing_feedback.listing_state (user_id, listing_id, state, at) values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'hidden', now())$q$,
    $q$insert into listing_feedback.verdicts (user_id, listing_id, alert_id, verdict, at) values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'real_deal', now())$q$
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

-- RLS: a user sees, updates and inserts only their own rows, through withUser (app.user_id).
insert into switches.switches (name, kind, state) values ('listing-feedback', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into listing_feedback.verdicts (id, user_id, listing_id, verdict, at) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'real_deal', now()),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 'not_a_deal', now());

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select count(*) from listing_feedback.v_listing_feedback_mine) <> 1 then
    raise exception 'v_listing_feedback_mine does not show exactly the user''s own row';
  end if;
  if exists (select 1 from listing_feedback.verdicts where id = '00000000-0000-4000-8000-0000000000c2') then
    raise exception 'nabvy_app can see another user''s verdict';
  end if;
  update listing_feedback.verdicts set verdict = 'bought'
    where id = '00000000-0000-4000-8000-0000000000c2';
  if found then
    raise exception 'nabvy_app updated another user''s verdict';
  end if;
end;
$$;
do $$
declare
  refused boolean;
begin
  refused := false;
  begin
    insert into listing_feedback.verdicts (user_id, listing_id, verdict, at)
      values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 'bought', now());
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app inserted a row for another user';
  end if;
end;
$$;
reset role;

-- The switch filter (rule 11): off empties both views; shadow shows internal rows only.
update switches.switches set state = 'shadow' where name = 'listing-feedback';
set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if exists (select 1 from listing_feedback.v_listing_feedback_mine) then
    raise exception 'v_listing_feedback_mine shows rows while the module is in shadow';
  end if;
end;
$$;
reset role;
set local role nabvy_pipeline;
do $$
begin
  if not exists (select 1 from listing_feedback.v_verdict_counts) then
    raise exception 'v_verdict_counts is empty in shadow, where it should still have rows';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'off' where name = 'listing-feedback';
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from listing_feedback.v_verdict_counts) then
    raise exception 'v_verdict_counts shows rows while the module is off';
  end if;
end;
$$;
reset role;

-- A suppressed listing never reaches the user-facing view (rule 5), whether the module is on.
update switches.switches set state = 'on' where name = 'listing-feedback';
insert into switches.switches (name, kind, state) values
  ('listing-ingest', 'module', 'on'), ('detail-evidence', 'module', 'on'), ('listing-suppression', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into listing_ingest.listings
  (id, source, source_listing_id, card_hash, title, first_fetched_at, last_seen_at, availability, item_job_id, item_seq)
values
  ('00000000-0000-4000-8000-0000000000d1', 'facebook', 'db-test-listing-feedback-1', repeat('0', 64), 'A listing', now(), now(), 'live', 0, 0);
insert into listing_feedback.verdicts (user_id, listing_id, verdict, at) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', 'real_deal', now());
insert into listing_suppression.entries (request_id, kind, value) values
  ('00000000-0000-4000-8000-0000000000e1', 'listing_hash', listing_suppression.listing_hash('facebook', 'db-test-listing-feedback-1'));

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if exists (
    select 1 from listing_feedback.v_listing_feedback_mine
    where listing_id = '00000000-0000-4000-8000-0000000000d1'
  ) then
    raise exception 'v_listing_feedback_mine shows a suppressed listing';
  end if;
end;
$$;
reset role;

rollback;
