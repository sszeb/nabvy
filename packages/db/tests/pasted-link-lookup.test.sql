-- pasted-link-lookup: grants, RLS isolation (cross-user select, update and insert), the
-- restrictive insert policy (server time only; no failure from the app), the switch filter, the
-- view columns and the suppression filter. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
begin
  -- The web app inserts and reads its own rows inside withUser; the pipeline reads, moves
  -- requests on (settle) and purges a deleted account's rows.
  if not (has_table_privilege('nabvy_app', 'pasted_link_lookup.requests', 'select')
          and has_table_privilege('nabvy_app', 'pasted_link_lookup.requests', 'insert')) then
    raise exception 'nabvy_app lacks its requests grants';
  end if;
  if has_table_privilege('nabvy_app', 'pasted_link_lookup.requests', 'update')
     or has_table_privilege('nabvy_app', 'pasted_link_lookup.requests', 'delete') then
    raise exception 'nabvy_app can update or delete requests';
  end if;
  if not (has_table_privilege('nabvy_pipeline', 'pasted_link_lookup.requests', 'select')
          and has_table_privilege('nabvy_pipeline', 'pasted_link_lookup.requests', 'update')
          and has_table_privilege('nabvy_pipeline', 'pasted_link_lookup.requests', 'delete')) then
    raise exception 'nabvy_pipeline lacks its requests grants';
  end if;
  if has_table_privilege('nabvy_pipeline', 'pasted_link_lookup.requests', 'insert') then
    raise exception 'nabvy_pipeline can insert requests (submits must go through withUser)';
  end if;

  -- Views: the internal one to the pipeline only, the user-facing one to the web app only.
  if not has_table_privilege('nabvy_pipeline', 'pasted_link_lookup.v_request_counts', 'select')
     or has_table_privilege('nabvy_app', 'pasted_link_lookup.v_request_counts', 'select') then
    raise exception 'v_request_counts grants are wrong';
  end if;
  if not has_table_privilege('nabvy_app', 'app.v_pasted_link_lookup_requests', 'select')
     or has_table_privilege('nabvy_pipeline', 'app.v_pasted_link_lookup_requests', 'select') then
    raise exception 'v_pasted_link_lookup_requests grants are wrong';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'app.v_pasted_link_lookup_requests', 'select') then
      raise exception '% can read app.v_pasted_link_lookup_requests', r;
    end if;
    if has_schema_privilege(r, 'pasted_link_lookup', 'usage') then
      raise exception '% can use schema pasted_link_lookup', r;
    end if;
  end loop;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'app' and table_name = 'v_pasted_link_lookup_requests')
     is distinct from array['request_id', 'source', 'source_listing_id', 'listing_id', 'status', 'requested_at', 'ready_at'] then
    raise exception 'v_pasted_link_lookup_requests has other columns than the allowed list';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'pasted_link_lookup' and table_name = 'v_request_counts')
     is distinct from array['user_id', 'day', 'n'] then
    raise exception 'v_request_counts has other columns than the allowed list';
  end if;
  if not (select coalesce((select option_value::boolean from pg_options_to_table(c.reloptions)
                            where option_name = 'security_invoker'), false)
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'v_pasted_link_lookup_requests') then
    raise exception 'app.v_pasted_link_lookup_requests is not security_invoker';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'pasted_link_lookup.%') then
    raise exception 'a pasted_link_lookup view breaks the view rules';
  end if;
end;
$$;

-- Constraints: only the allowed source, a digits-only listing ID, the three statuses, and
-- ready_at / outcome present exactly with their status.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status) values ('00000000-0000-4000-8000-0000000000b1', 'gumtree', '1', 'queued')$q$,
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status) values ('00000000-0000-4000-8000-0000000000b1', 'facebook', 'abc', 'queued')$q$,
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status) values ('00000000-0000-4000-8000-0000000000b1', 'facebook', '1', 'done')$q$,
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status) values ('00000000-0000-4000-8000-0000000000b1', 'facebook', '1', 'ready')$q$,
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status) values ('00000000-0000-4000-8000-0000000000b1', 'facebook', '1', 'failed')$q$
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

-- RLS: a user sees and inserts only their own rows, through withUser (app.user_id); the app may
-- insert only a fresh request stamped with server time, never a failure or a backdated one.
insert into switches.switches (name, kind, state) values ('pasted-link-lookup', 'module', 'on'), ('listing-suppression', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into pasted_link_lookup.requests (id, user_id, source, source_listing_id, status) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'facebook', '12345678901234567', 'queued'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2', 'facebook', '12345678901234567', 'queued');

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select count(*) from app.v_pasted_link_lookup_requests) <> 1 then
    raise exception 'v_pasted_link_lookup_requests does not show exactly the user''s own row';
  end if;
  if exists (select 1 from pasted_link_lookup.requests where id = '00000000-0000-4000-8000-0000000000c2') then
    raise exception 'nabvy_app can see another user''s request';
  end if;
end;
$$;
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status) values ('00000000-0000-4000-8000-0000000000b2', 'facebook', '2', 'queued')$q$,
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status, requested_at) values ('00000000-0000-4000-8000-0000000000b1', 'facebook', '3', 'queued', now() - interval '2 days')$q$,
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status, ready_at) values ('00000000-0000-4000-8000-0000000000b1', 'facebook', '4', 'ready', now() - interval '1 hour')$q$,
    $q$insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status, outcome) values ('00000000-0000-4000-8000-0000000000b1', 'facebook', '5', 'failed', 'expired')$q$,
    $q$update pasted_link_lookup.requests set status = 'failed', outcome = 'expired' where id = '00000000-0000-4000-8000-0000000000c1'$q$,
    $q$update pasted_link_lookup.requests set status = 'failed', outcome = 'expired' where id = '00000000-0000-4000-8000-0000000000c2'$q$,
    $q$delete from pasted_link_lookup.requests where id = '00000000-0000-4000-8000-0000000000c1'$q$
  ] loop
    refused := false;
    begin
      execute probe;
    exception when insufficient_privilege then
      refused := true;
    end;
    if not refused then
      raise exception 'nabvy_app was not refused: %', probe;
    end if;
  end loop;
  -- A fresh request stamped with server time, for the caller, is allowed.
  insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status)
    values ('00000000-0000-4000-8000-0000000000b1', 'facebook', '6', 'queued');
  insert into pasted_link_lookup.requests (user_id, source, source_listing_id, status, ready_at)
    values ('00000000-0000-4000-8000-0000000000b1', 'facebook', '7', 'ready', now());
end;
$$;
reset role;

-- The pipeline moves a request on and sees every user's rows.
set local role nabvy_pipeline;
do $$
begin
  if (select count(*) from pasted_link_lookup.requests) <> 4 then
    raise exception 'nabvy_pipeline does not see every request';
  end if;
  update pasted_link_lookup.requests set status = 'ready', ready_at = now(),
    listing_id = '00000000-0000-4000-8000-0000000000d1'
    where id = '00000000-0000-4000-8000-0000000000c2';
  if not found then
    raise exception 'nabvy_pipeline could not move a request on';
  end if;
  if (select count(*) from pasted_link_lookup.v_request_counts) <> 2 then
    raise exception 'v_request_counts does not show one row per user and day';
  end if;
end;
$$;
reset role;

-- The switch filter (rule 11): off empties both views; shadow shows internal rows only.
update switches.switches set state = 'shadow' where name = 'pasted-link-lookup';
set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if exists (select 1 from app.v_pasted_link_lookup_requests) then
    raise exception 'v_pasted_link_lookup_requests shows rows while the module is in shadow';
  end if;
end;
$$;
reset role;
set local role nabvy_pipeline;
do $$
begin
  if not exists (select 1 from pasted_link_lookup.v_request_counts) then
    raise exception 'v_request_counts is empty in shadow, where it should still have rows';
  end if;
end;
$$;
reset role;
update switches.switches set state = 'off' where name = 'pasted-link-lookup';
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from pasted_link_lookup.v_request_counts) then
    raise exception 'v_request_counts shows rows while the module is off';
  end if;
end;
$$;
reset role;

-- A request whose listing is suppressed never reaches the user-facing view (rule 5), and the
-- view is empty while listing-suppression is off (rule 11).
update switches.switches set state = 'on' where name = 'pasted-link-lookup';
insert into switches.switches (name, kind, state) values
  ('listing-ingest', 'module', 'on'), ('detail-evidence', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into listing_ingest.listings
  (id, source, source_listing_id, card_hash, title, first_fetched_at, last_seen_at, availability, item_job_id, item_seq)
values
  ('00000000-0000-4000-8000-0000000000d2', 'facebook', '9876543210', repeat('0', 64), 'A listing', now(), now(), 'live', 0, 0);
insert into pasted_link_lookup.requests (user_id, source, source_listing_id, listing_id, status, ready_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'facebook', '9876543210', '00000000-0000-4000-8000-0000000000d2', 'ready', now());
insert into listing_suppression.entries (request_id, kind, value) values
  ('00000000-0000-4000-8000-0000000000e1', 'listing_hash', listing_suppression.listing_hash('facebook', '9876543210'));

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if exists (
    select 1 from app.v_pasted_link_lookup_requests
    where listing_id = '00000000-0000-4000-8000-0000000000d2'
  ) then
    raise exception 'v_pasted_link_lookup_requests shows a suppressed listing';
  end if;
  if (select count(*) from app.v_pasted_link_lookup_requests) <> 3 then
    raise exception 'v_pasted_link_lookup_requests does not show the user''s other rows';
  end if;
end;
$$;
reset role;
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if exists (select 1 from app.v_pasted_link_lookup_requests) then
    raise exception 'v_pasted_link_lookup_requests shows rows while listing-suppression is off';
  end if;
end;
$$;
reset role;

rollback;
