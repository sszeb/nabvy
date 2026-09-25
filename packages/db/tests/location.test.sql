-- location: grants and constraints on real Postgres (pnpm db:dry-run). Rolled back. This module
-- publishes no views (services/location/README.md, "Outputs"), so there is nothing here for
-- nabvy_core.view_violations() to check.
begin;
set local client_min_messages = warning;

-- Grants: both application roles may select and insert the cache; neither may delete it, and
-- neither anon nor authenticated may reach the schema at all.
do $$
begin
  if not (has_table_privilege('nabvy_app', 'location.postcode_cache', 'select')
          and has_table_privilege('nabvy_app', 'location.postcode_cache', 'insert')
          and has_table_privilege('nabvy_pipeline', 'location.postcode_cache', 'select')
          and has_table_privilege('nabvy_pipeline', 'location.postcode_cache', 'insert')) then
    raise exception 'nabvy_app or nabvy_pipeline lacks its postcode_cache grants';
  end if;
  if has_table_privilege('nabvy_app', 'location.postcode_cache', 'delete')
     or has_table_privilege('nabvy_pipeline', 'location.postcode_cache', 'delete') then
    raise exception 'a role can delete from postcode_cache';
  end if;
  if has_table_privilege('nabvy_app', 'location.postcode_cache', 'update')
     or has_table_privilege('nabvy_pipeline', 'location.postcode_cache', 'update') then
    raise exception 'a role can update postcode_cache (it is append-only)';
  end if;
  if has_schema_privilege('anon', 'location', 'usage')
     or has_schema_privilege('authenticated', 'location', 'usage') then
    raise exception 'anon or authenticated can use schema location';
  end if;
end;
$$;

-- Constraints: a postcode is cached once, and only a valid coordinate is accepted.
do $$
declare
  refused boolean;
  probe text;
begin
  insert into location.postcode_cache (postcode, lat, lng)
    values ('SW1A 1AA', 51.5010, -0.1416);
  begin
    insert into location.postcode_cache (postcode, lat, lng) values ('SW1A 1AA', 0, 0);
    raise exception 'a second row for the same postcode was not refused';
  exception when unique_violation then
    null;
  end;

  foreach probe in array array[
    $q$insert into location.postcode_cache (postcode, lat, lng) values ('XX1 1XX', 91, 0)$q$,
    $q$insert into location.postcode_cache (postcode, lat, lng) values ('XX2 2XX', 0, 181)$q$,
    $q$insert into location.postcode_cache (postcode, lat, lng) values ('XX3 3XX', -91, 0)$q$,
    $q$insert into location.postcode_cache (postcode, lat, lng) values ('XX4 4XX', 0, -181)$q$
  ] loop
    refused := false;
    begin
      execute probe;
    exception when check_violation then
      refused := true;
    end;
    if not refused then
      raise exception 'not refused: %', probe;
    end if;
  end loop;
end;
$$;

rollback;
