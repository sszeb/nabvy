-- Access and views for the asking_price_index schema (packages/db/README.md, "Adding tables to a
-- module"; services/asking-price-index/README.md). Depends on core (track_updated_at) and switches
-- (switches.state, switches.is_on). The module reads other modules' views from pipeline code only;
-- no view here reads another module, so the user-facing view needs no SECURITY DEFINER function
-- (docs/security.md, "Cross-module reads behind a user-facing view").
--
-- Groups and figures are pipeline data with no user rows, so there is no user_id. Only the
-- pipeline role (nabvy_pipeline; per-module roles are question 2 of the catalogue) writes the
-- tables; it may delete for erase() and for members that left a group. nabvy_app reads only the
-- band columns, through app.v_asking_price_index_bands, at n>=10 (nabvy/docs/decisions.md:15).
-- `thin` is derived from seller keys and is never granted to nabvy_app (rule 5).

grant usage on schema asking_price_index to nabvy_pipeline;
grant select, insert, update, delete
  on asking_price_index.groups, asking_price_index.members, asking_price_index.stats
  to nabvy_pipeline;

select nabvy_core.track_updated_at('asking_price_index.groups');
select nabvy_core.track_updated_at('asking_price_index.members');
select nabvy_core.track_updated_at('asking_price_index.stats');

-- Internal views: security_invoker, explicit columns, no seller field or seller key (none is
-- stored). Empty while the module's switch is off (rule 11).

-- Each group with its figures. `thin` and `copy_collapse` are internal marks.
create view asking_price_index.v_groups with (security_invoker = true) as
select
  g.group_key, g.catalogue_id, g.context, g.condition, g.country, g.currency, g.window_days,
  g.label, s.n, s.median, s.mad, s.p25, s.p75, s.min, s.max, s.thin, s.copy_collapse, s.as_of
from asking_price_index.groups g
left join asking_price_index.stats s on s.group_key = g.group_key
where switches.state('asking-price-index') <> 'off';

-- Every member with its ask and whether it counts (collapse keys stay in the table).
create view asking_price_index.v_members with (security_invoker = true) as
select m.group_key, m.listing_id, m.ask_minor, m.counted, m.excluded, m.sample_origin, m.seen_at
from asking_price_index.members m
where switches.state('asking-price-index') <> 'off';

-- Implied value of "everything except" the item: the median PC ask holding it minus its median
-- standalone ask, same condition, country, currency and window. Internal, for sensitivities only
-- (PARTS_INTELLIGENCE.md:108-113,268-271). The two IQRs are never added into one range
-- (PARTS_INTELLIGENCE.md:119-120): each side keeps its own n and quartiles.
create view asking_price_index.v_implied with (security_invoker = true) as
select
  pc.catalogue_id, pc.condition, pc.country, pc.currency, pc.window_days,
  pc.group_key as pc_group_key, part.group_key as part_group_key,
  pcs.n as pc_n, pcs.median as pc_median, pcs.p25 as pc_p25, pcs.p75 as pc_p75,
  ps.n as part_n, ps.median as part_median, ps.p25 as part_p25, ps.p75 as part_p75,
  pcs.median - ps.median as implied_rest_minor
from asking_price_index.groups pc
join asking_price_index.stats pcs on pcs.group_key = pc.group_key
join asking_price_index.groups part
  on part.catalogue_id = pc.catalogue_id and part.condition = pc.condition
  and part.country = pc.country and part.currency = pc.currency
  and part.window_days = pc.window_days and part.context = 'standalone'
join asking_price_index.stats ps on ps.group_key = part.group_key
where pc.context = 'in_pc' and pcs.n > 0 and ps.n > 0
  and switches.state('asking-price-index') <> 'off';

-- Health per group: counted n, members, by-catch share of counted asks, newest ask, city pages.
create view asking_price_index.v_group_health with (security_invoker = true) as
select
  m.group_key,
  count(*) filter (where m.counted)::integer as n,
  count(*)::integer as members,
  case when count(*) filter (where m.counted) = 0 then null
    else round(
      (count(*) filter (where m.counted and m.sample_origin = 'by_catch'))::numeric
        / count(*) filter (where m.counted), 3)
  end as by_catch_share,
  max(m.seen_at) filter (where m.counted) as newest_seen_at,
  count(distinct m.city_page_id) filter (where m.counted)::integer as city_pages
from asking_price_index.members m
where switches.state('asking-price-index') <> 'off'
group by m.group_key;

revoke all on asking_price_index.v_groups, asking_price_index.v_members,
  asking_price_index.v_implied, asking_price_index.v_group_health
  from public, anon, authenticated;
grant select on asking_price_index.v_groups, asking_price_index.v_members,
  asking_price_index.v_implied, asking_price_index.v_group_health
  to nabvy_pipeline;

-- User-facing bands: label, n, median, the p25-p75 range and currency, only at n>=10 and only
-- while this module and listing-suppression are on (rules 5 and 11). No position, no "worth" or
-- "fair" (nabvy/docs/decisions.md:15), no seller key, no thin mark. Suppressed listings never
-- count (the pipeline marks them `suppressed`), so the aggregate needs no anti-join.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to nabvy_app;

create view app.v_asking_price_index_bands with (security_invoker = true) as
select
  g.group_key, g.label, s.n, s.median, s.p25 as range_low, s.p75 as range_high, g.currency
from asking_price_index.groups g
join asking_price_index.stats s on s.group_key = g.group_key
where s.n >= 10 and s.median is not null
  and switches.is_on('asking-price-index')
  and switches.is_on('listing-suppression');

revoke all on app.v_asking_price_index_bands from public, anon, authenticated;
grant select on app.v_asking_price_index_bands to nabvy_app;

-- The view is security_invoker, so nabvy_app needs the band columns and nothing else; row-level
-- security repeats the n>=10 and switch conditions on the tables themselves.
grant usage on schema asking_price_index to nabvy_app;
grant select (group_key, label, currency) on asking_price_index.groups to nabvy_app;
grant select (group_key, n, median, p25, p75) on asking_price_index.stats to nabvy_app;

alter table asking_price_index.groups enable row level security;
alter table asking_price_index.stats enable row level security;
alter table asking_price_index.members enable row level security;
create policy pipeline_all on asking_price_index.groups for all to nabvy_pipeline
  using (true) with check (true);
create policy pipeline_all on asking_price_index.stats for all to nabvy_pipeline
  using (true) with check (true);
create policy pipeline_all on asking_price_index.members for all to nabvy_pipeline
  using (true) with check (true);
create policy app_bands on asking_price_index.groups for select to nabvy_app
  using (switches.is_on('asking-price-index') and switches.is_on('listing-suppression'));
create policy app_bands on asking_price_index.stats for select to nabvy_app
  using (n >= 10 and switches.is_on('asking-price-index')
         and switches.is_on('listing-suppression'));
