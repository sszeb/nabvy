-- seller-reply-reports: grants, RLS isolation, the switch and suppression filters, and the views
-- (services/seller-reply-reports/README.md). Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
  v text;
begin
  -- The web app inserts its own reports and may only withdraw them; internal columns stay out of
  -- its reach. The pipeline assesses, resolves and purges.
  if not (has_column_privilege('nabvy_app', 'seller_reply_reports.reports', 'listing_id', 'insert')
          and has_column_privilege('nabvy_app', 'seller_reply_reports.reports', 'withdrawn_at', 'update')) then
    raise exception 'nabvy_app lacks its reports grants';
  end if;
  foreach v in array array['eligibility', 'weight', 'weight_at_submit', 'outcome', 'outcome_by', 'tester', 'note_text'] loop
    if has_column_privilege('nabvy_app', 'seller_reply_reports.reports', v, 'select')
       or has_column_privilege('nabvy_app', 'seller_reply_reports.reports', v, 'update')
       or has_column_privilege('nabvy_app', 'seller_reply_reports.reports', v, 'insert') then
      raise exception 'nabvy_app can reach reports.%', v;
    end if;
  end loop;
  if has_table_privilege('nabvy_app', 'seller_reply_reports.reports', 'delete') then
    raise exception 'nabvy_app can delete reports';
  end if;
  foreach v in array array['listing_evidence', 'holds', 'reporter_stats'] loop
    if has_any_column_privilege('nabvy_app', 'seller_reply_reports.' || v, 'select') then
      raise exception 'nabvy_app can read %', v;
    end if;
  end loop;
  if has_any_column_privilege('nabvy_pipeline', 'seller_reply_reports.reports', 'insert') then
    raise exception 'nabvy_pipeline can insert reports (they come from users, inside withUser)';
  end if;

  -- Internal views to the pipeline only (v_reporter_signals included: account-integrity and the
  -- admin path, until per-module roles exist); the user-facing view to the web app only.
  foreach v in array array['v_listing_evidence', 'v_review_items', 'v_shadow_metrics', 'v_reporter_signals'] loop
    if not has_table_privilege('nabvy_pipeline', 'seller_reply_reports.' || v, 'select')
       or has_table_privilege('nabvy_app', 'seller_reply_reports.' || v, 'select') then
      raise exception '% grants are wrong', v;
    end if;
  end loop;
  if not has_table_privilege('nabvy_app', 'app.v_seller_reply_reports_mine', 'select')
     or has_table_privilege('nabvy_pipeline', 'app.v_seller_reply_reports_mine', 'select') then
    raise exception 'app.v_seller_reply_reports_mine grants are wrong';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'app' and table_name = 'v_seller_reply_reports_mine')
     is distinct from array['report_id', 'listing_id', 'reasons', 'status', 'created_at', 'withdrawable'] then
    raise exception 'app.v_seller_reply_reports_mine has other columns than the allowed list';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'seller_reply_reports' and table_name in ('v_listing_evidence', 'v_review_items', 'v_shadow_metrics')
               and (column_name like '%user%' or column_name like 'reporter%')) then
    raise exception 'an internal view other than v_reporter_signals carries a user ID';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'seller_reply_reports', 'usage') then
      raise exception '% can use schema seller_reply_reports', r;
    end if;
    if has_table_privilege(r, 'app.v_seller_reply_reports_mine', 'select') then
      raise exception '% can read app.v_seller_reply_reports_mine', r;
    end if;
  end loop;
  if exists (select 1 from nabvy_core.view_violations()
             where view_name like 'seller_reply_reports.%' or view_name = 'app.v_seller_reply_reports_mine') then
    raise exception 'a seller_reply_reports view breaks the view rules';
  end if;
end;
$$;

-- Constraints: codes only, no free text.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into seller_reply_reports.reports (source, listing_id, reporter_user_id, rule_version, note_text) values ('facebook', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'x', 'free text')$q$,
    $q$insert into seller_reply_reports.reports (source, listing_id, reporter_user_id, rule_version, status) values ('facebook', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'x', 'marked')$q$
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

-- RLS and the switch: two users' reports; each sees only their own, only while on (shadow:
-- testers only), never on a suppressed listing, and nothing while listing-suppression is off.
insert into switches.switches (name, kind, state) values
  ('seller-reply-reports', 'module', 'on'), ('listing-suppression', 'module', 'on')
  on conflict (name) do update set state = excluded.state;
insert into seller_reply_reports.reports (id, source, listing_id, reporter_user_id, rule_version) values
  ('00000000-0000-4000-8000-0000000000c1', 'facebook', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'x'),
  ('00000000-0000-4000-8000-0000000000c2', 'facebook', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', 'x');
insert into seller_reply_reports.report_reasons (report_id, reason) values
  ('00000000-0000-4000-8000-0000000000c1', 'payment_first'), ('00000000-0000-4000-8000-0000000000c2', 'other');

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select count(*) from app.v_seller_reply_reports_mine) <> 1 then
    raise exception 'app.v_seller_reply_reports_mine does not show exactly the user''s own report';
  end if;
  if exists (select 1 from seller_reply_reports.reports where id = '00000000-0000-4000-8000-0000000000c2')
     or exists (select 1 from seller_reply_reports.report_reasons where report_id = '00000000-0000-4000-8000-0000000000c2') then
    raise exception 'nabvy_app can see another user''s report';
  end if;
  update seller_reply_reports.reports set status = 'withdrawn', withdrawn_at = now()
    where id = '00000000-0000-4000-8000-0000000000c2';
  if found then
    raise exception 'nabvy_app withdrew another user''s report';
  end if;
end;
$$;
do $$
declare
  refused boolean := false;
begin
  begin
    update seller_reply_reports.reports set status = 'helping_warn'
      where id = '00000000-0000-4000-8000-0000000000c1';
  exception when insufficient_privilege or check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app set a status other than withdrawn';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'shadow' where name = 'seller-reply-reports';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from app.v_seller_reply_reports_mine) then
    raise exception 'shadow shows reports to a non-tester';
  end if;
end;
$$;
reset role;
insert into seller_reply_reports.testers (user_id, added_by, audit_id, added_at)
  values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', now());
set local role nabvy_app;
do $$
begin
  if (select count(*) from app.v_seller_reply_reports_mine) <> 1 then
    raise exception 'shadow hides the tester''s own report';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'on' where name = 'seller-reply-reports';
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from app.v_seller_reply_reports_mine) then
    raise exception 'app.v_seller_reply_reports_mine shows rows while listing-suppression is off';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'off' where name = 'seller-reply-reports';
update switches.switches set state = 'on' where name = 'listing-suppression';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from app.v_seller_reply_reports_mine) then
    raise exception 'app.v_seller_reply_reports_mine shows rows while the module is off';
  end if;
end;
$$;
reset role;
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from seller_reply_reports.v_review_items) then
    raise exception 'v_review_items shows rows while the module is off';
  end if;
end;
$$;
reset role;

rollback;
