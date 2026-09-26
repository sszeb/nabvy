-- asking-price-position (services/asking-price-position): only the pipeline writes the table; the
-- internal view is empty while the switch is off; the user-facing view has exactly its allowed
-- columns, shows only n >= 10, hides suppressed listings, and returns no rows while
-- listing-suppression or asking-price-index is off; nabvy_app reads neither the score nor the
-- hashes (rules 5 and 11). Rolled back.
begin;
set local client_min_messages = warning;

do $$
begin
  if has_schema_privilege('anon', 'asking_price_position', 'usage')
     or has_schema_privilege('authenticated', 'asking_price_position', 'usage') then
    raise exception 'asking_price_position is reachable by a Data API role';
  end if;
  if exists (select 1 from nabvy_core.view_violations()
             where view_name like 'asking_price_position.%'
                or view_name like 'app.v_asking_price_position%') then
    raise exception 'asking_price_position views break the view conventions';
  end if;
  if has_column_privilege('nabvy_app', 'asking_price_position.positions', 'percentile', 'select')
     or has_column_privilege('nabvy_app', 'asking_price_position.positions', 'robust_z', 'select')
     or has_column_privilege('nabvy_app', 'asking_price_position.positions', 'card_hash', 'select')
     or has_table_privilege('nabvy_app', 'asking_price_position.positions', 'insert')
     or has_table_privilege('nabvy_app', 'asking_price_position.positions', 'update')
     or has_table_privilege('nabvy_app', 'asking_price_position.positions', 'delete')
     or has_table_privilege('nabvy_app', 'asking_price_position.v_positions', 'select') then
    raise exception 'nabvy_app reaches more than the shown columns';
  end if;
  if (select array_agg(column_name::text order by ordinal_position)
        from information_schema.columns
       where table_schema = 'app' and table_name = 'v_asking_price_position')
     <> array['listing_id', 'label', 'rank', 'n', 'median', 'range_low', 'range_high', 'currency'] then
    raise exception 'app.v_asking_price_position has other columns than allowed';
  end if;
  if not has_table_privilege('nabvy_app', 'app.v_asking_price_position', 'select') then
    raise exception 'nabvy_app cannot read the positions';
  end if;
end;
$$;

insert into switches.switches (name, kind, state) values
  ('asking-price-position', 'module', 'on'), ('asking-price-index', 'module', 'on'),
  ('listing-suppression', 'module', 'on'), ('listing-ingest', 'module', 'on'),
  ('detail-evidence', 'module', 'on')
on conflict (name) do update set state = excluded.state;

insert into asking_price_position.positions
  (listing_id, group_key, ask_minor, rank, n, percentile, robust_z, label, median, range_low,
   range_high, currency, card_hash, evidence_hash, stats_as_of, rule_version, positioned_at)
values
  ('01900000-0000-7000-8000-000000000001', 'gpu:rtx-3090|standalone|used_good|GB|GBP|30d', 60000,
   1, 10, 5, -1.2, 'RTX 3090, on its own, used, good', 62000, 61000, 63000, 'GBP', 'c', 'e', now(),
   'p1', now()),
  ('01900000-0000-7000-8000-000000000002', 'gpu:rtx-3080|standalone|used_good|GB|GBP|30d', 40000,
   1, 9, 5.6, null, 'RTX 3080, on its own, used, good', 41000, 40500, 42000, 'GBP', 'c', 'e', now(),
   'p1', now());

set local role nabvy_app;
do $$
begin
  if (select count(*) from app.v_asking_price_position) <> 1 then
    raise exception 'positions must show only at n >= 10';
  end if;
end;
$$;
reset role;

-- A suppressed listing never shows (rule 5), through the view or a direct read of the table
-- (row-level security repeats the check). The shown listing is ingested and then suppressed by
-- its hash.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, title,
  first_fetched_at, last_seen_at, availability, item_job_id, item_seq, price_minor, currency,
  money_kind, binding, city_page_id, found_by_terms)
values ('01900000-0000-7000-8000-000000000001', 'facebook', 'fb-app-1', repeat('a', 64), 'Listing',
  now(), now(), 'live', 1, 1, 60000, 'GBP', 'fixed', 'verified', null, '{}');
insert into listing_suppression.entries (kind, value, request_id)
values ('listing_hash', listing_suppression.listing_hash('facebook', 'fb-app-1'),
  '01900000-0000-7000-8000-0000000000ff');
set local role nabvy_app;
do $$
begin
  if exists (select 1 from app.v_asking_price_position) then
    raise exception 'a suppressed listing must not show in the view';
  end if;
  if exists (select 1 from asking_price_position.positions) then
    raise exception 'a suppressed listing must not show in a direct read of the table';
  end if;
end;
$$;
reset role;
delete from listing_suppression.entries where request_id = '01900000-0000-7000-8000-0000000000ff';
set local role nabvy_app;
do $$
begin
  if (select count(*) from asking_price_position.positions) <> 1 then
    raise exception 'the unsuppressed n>=10 position must be readable again';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from app.v_asking_price_position) then
    raise exception 'positions must be empty while listing-suppression is off';
  end if;
end;
$$;
reset role;
update switches.switches set state = 'on' where name = 'listing-suppression';

update switches.switches set state = 'off' where name = 'asking-price-index';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from app.v_asking_price_position) then
    raise exception 'positions must be empty while asking-price-index is off';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'shadow' where name = 'asking-price-position';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from app.v_asking_price_position) then
    raise exception 'positions must be empty in shadow';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'off' where name = 'asking-price-position';
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from asking_price_position.v_positions) then
    raise exception 'the internal view must be empty while the switch is off';
  end if;
end;
$$;
reset role;

rollback;
