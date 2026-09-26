-- want-manager: grants, RLS, functions, views. Hand-written (packages/db/README.md). Depends on
-- core (uuidv7, track_updated_at, RLS/pipeline helpers, current_user_id), switches
-- (switches.state/is_on), city-pages (v_centres, v_city_pages, haversine_km: the nearest
-- centre), subscriptions (v_entitlements: the paid flag) and product-catalogue (v_items: the
-- family of a catalogue ID) and account (v_standing: the fair-use cap).
comment on schema want_manager is
  'Want manager: what each user wants and how they want to hear about it. Owner: the want-manager module.';
grant usage on schema want_manager to nabvy_app, nabvy_pipeline;

-- wants, criteria, preferences: written entirely by the web app inside withUser (upsertWant,
-- setActive, deleteWant, setPreferences; services/want-manager/src/index.ts). The user may delete
-- a want, so nabvy_app has delete too. The pipeline only reads (for the internal views and
-- wantOwners) and deletes (the account.deleted purge, rule 12 of docs/design/modules/_rules.md).
select nabvy_core.enable_user_rls('want_manager.wants');
grant select, insert, update, delete on want_manager.wants to nabvy_app;
select nabvy_core.allow_pipeline('want_manager.wants', 'select');
select nabvy_core.allow_pipeline('want_manager.wants', 'delete');
grant select, delete on want_manager.wants to nabvy_pipeline;
select nabvy_core.track_updated_at('want_manager.wants');

select nabvy_core.enable_user_rls('want_manager.criteria');
grant select, insert, update, delete on want_manager.criteria to nabvy_app;
select nabvy_core.allow_pipeline('want_manager.criteria', 'select');
select nabvy_core.allow_pipeline('want_manager.criteria', 'delete');
grant select, delete on want_manager.criteria to nabvy_pipeline;
select nabvy_core.track_updated_at('want_manager.criteria');

select nabvy_core.enable_user_rls('want_manager.preferences');
grant select, insert, update, delete on want_manager.preferences to nabvy_app;
select nabvy_core.allow_pipeline('want_manager.preferences', 'select');
select nabvy_core.allow_pipeline('want_manager.preferences', 'delete');
grant select, delete on want_manager.preferences to nabvy_pipeline;
select nabvy_core.track_updated_at('want_manager.preferences');

-- The nearest active search centre with a resolved coordinate for a point (card: "mapped to the
-- nearest grid centre, verified or not"). The web app calls it inside withUser as nabvy_app, which
-- has no grant on city-pages' internal views, so it is SECURITY DEFINER in the shape
-- docs/security.md fixes: language sql, stable, pinned search_path, every name schema-qualified,
-- an explicit returns table, reads the other module only through its v_ views, and it takes a
-- plain point, never a user or seller column. Empty while city-pages is off (v_centres has no
-- rows then), so a want keeps a null centre until the next save. A verified centre's coordinate is
-- Facebook's own reported one; until then the city page's seed coordinate, as
-- city_pages.v_area_membership resolves it.
create function want_manager.nearest_centre(p_lat double precision, p_lng double precision)
returns table (centre_id text, verified boolean, distance_km double precision)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    c.city_page_id,
    c.verified,
    city_pages.haversine_km(p_lat, p_lng, coalesce(c.reported_lat, p.lat), coalesce(c.reported_lng, p.lng))
  from city_pages.v_centres c
  join city_pages.v_city_pages p on p.city_page_id = c.city_page_id
  where c.active
    and coalesce(c.reported_lat, p.lat) is not null
    and coalesce(c.reported_lng, p.lng) is not null
  order by 3 asc, c.verified desc, c.city_page_id
  limit 1
$$;
revoke all on function want_manager.nearest_centre(double precision, double precision) from public;
grant execute on function want_manager.nearest_centre(double precision, double precision) to nabvy_app;

-- The fair-use cap on active wants for the current user, if account-integrity set one (card: "a
-- fair-use limit lowers the want cap", docs/decisions.md). account.v_standing is pipeline-only, so
-- this is the same SECURITY DEFINER shape, filtered inside its body on
-- nabvy_core.current_user_id(): outside withUser it returns nothing. One row at most; no row means
-- no fair-use cap.
create function want_manager.fair_use_want_cap()
returns table (max_active_hunts integer)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select (s.limits ->> 'maxActiveHunts')::integer
  from account.v_standing s
  where s.user_id = nabvy_core.current_user_id()
    and s.limits ? 'maxActiveHunts'
$$;
revoke all on function want_manager.fair_use_want_cap() from public;
grant execute on function want_manager.fair_use_want_cap() to nabvy_app;

-- Internal: every want with its criteria as one JSON array, for spec-match, alert-router,
-- similar-picks and account-integrity. No user ID (card, "Views"); `paid` says whether the
-- owner holds a paid entitlement (subscriptions.v_entitlements, which is exempt from the switch
-- filter, so "subscriptions off" never reads as "free"). Rows while this module is shadow or on
-- (rule 11).
create view want_manager.v_wants with (security_invoker = true) as
  select
    w.id, w.centre_id, w.lat, w.lng, w.radius_km, w.price_cap_minor, w.currency, w.active,
    w.cadence_seconds, w.delivery_speed, w.delivery_methods, w.alternatives, w.pc_containment,
    w.alternatives_max_price_minor, w.instant_alternatives, w.instant_top_picks, w.filter,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'partType', c.part_type, 'catalogueId', c.catalogue_id, 'family', c.family,
        'minAttr', c.min_attr, 'orBetter', c.or_better) order by c.position), '[]'::jsonb)
      from want_manager.criteria c where c.want_id = w.id) as criteria,
    coalesce(e.status in ('trialing', 'active', 'past_due'), false) as paid,
    w.updated_at
  from want_manager.wants w
  left join subscriptions.v_entitlements e on e.user_id = w.user_id
  where switches.state('want-manager') <> 'off';
revoke all on want_manager.v_wants from public;
grant select on want_manager.v_wants to nabvy_pipeline;

-- Internal: want_count and paid_want_count per centre and family, for search-planner and
-- demand-signals (card, "Views"). The family is the criterion's own, else the catalogue item's
-- (product_catalogue.v_items, empty while that module is off), else the catalogue ID itself;
-- a sized part (RAM, storage) names no family and so is no search term. Active wants with a
-- centre only. Counts only, never user IDs.
create view want_manager.v_want_terms_by_centre with (security_invoker = true) as
  select
    w.centre_id,
    coalesce(c.family, i.family, c.catalogue_id) as family,
    count(distinct w.id) as want_count,
    count(distinct w.id) filter (where e.status in ('trialing', 'active', 'past_due')) as paid_want_count
  from want_manager.wants w
  join want_manager.criteria c on c.want_id = w.id
  left join product_catalogue.v_items i on i.catalogue_id = c.catalogue_id
  left join subscriptions.v_entitlements e on e.user_id = w.user_id
  where w.active
    and w.centre_id is not null
    and coalesce(c.family, i.family, c.catalogue_id) is not null
    and switches.state('want-manager') <> 'off'
  group by w.centre_id, coalesce(c.family, i.family, c.catalogue_id);
revoke all on want_manager.v_want_terms_by_centre from public;
grant select on want_manager.v_want_terms_by_centre to nabvy_pipeline;

-- Internal: the distinct wanted parts per centre, for photo-review (card, "Views").
create view want_manager.v_want_parts with (security_invoker = true) as
  select distinct w.centre_id, c.part_type, c.catalogue_id, c.family
  from want_manager.wants w
  join want_manager.criteria c on c.want_id = w.id
  where w.active
    and w.centre_id is not null
    and switches.state('want-manager') <> 'off';
revoke all on want_manager.v_want_parts from public;
grant select on want_manager.v_want_parts to nabvy_pipeline;

-- Internal: the areas active wants cover, for details-selector (card, "Views"): the centre, the
-- want's point rounded to a 0.05° grid (about 5 km, the same coarseness as location's distance
-- rounding; WANT_MANAGER_AREA_GRID_DEGREES in packages/config/src/modules/want-manager.ts), the
-- radius and whether any want in that cell accepts a posted item. Distinct rows, so the count of
-- wants behind a cell is not readable here.
create view want_manager.v_want_areas with (security_invoker = true) as
  select
    w.centre_id,
    (round(w.lat * 20) / 20)::double precision as lat,
    (round(w.lng * 20) / 20)::double precision as lng,
    w.radius_km,
    bool_or('posted' = any(w.delivery_methods)) as accepts_delivery
  from want_manager.wants w
  where w.active
    and w.centre_id is not null
    and switches.state('want-manager') <> 'off'
  group by w.centre_id, round(w.lat * 20), round(w.lng * 20), w.radius_km;
revoke all on want_manager.v_want_areas from public;
grant select on want_manager.v_want_areas to nabvy_pipeline;

-- User-facing: the caller's own wants (RLS through security_invoker), only while the switch is
-- on (rule 11). Explicit column list; no coordinates (the user's point is shown as its centre),
-- no seller field, nothing of any listing. It lives in this module's schema, not `app.*`, because
-- no `app` schema exists on main yet (the gap services/listing-feedback/README.md records); move
-- it once the web app's oRPC layer creates `app`.
create view want_manager.v_want_manager_wants with (security_invoker = true) as
  select
    w.id, w.centre_id, w.centre_verified, w.radius_km, w.price_cap_minor, w.currency, w.active,
    w.cadence_seconds, w.delivery_speed, w.delivery_methods, w.alternatives, w.pc_containment,
    w.alternatives_max_price_minor, w.instant_alternatives, w.instant_top_picks, w.filter,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'partType', c.part_type, 'catalogueId', c.catalogue_id, 'family', c.family,
        'minAttr', c.min_attr, 'orBetter', c.or_better) order by c.position), '[]'::jsonb)
      from want_manager.criteria c where c.want_id = w.id) as criteria,
    w.created_at, w.updated_at
  from want_manager.wants w
  where switches.is_on('want-manager');
revoke all on want_manager.v_want_manager_wants from public;
grant select on want_manager.v_want_manager_wants to nabvy_app;
