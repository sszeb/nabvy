-- router-gateway (services/router-gateway): the call log holds no coordinate, only the pipeline
-- role writes it, and only the outcome columns can change. Rolled back.
begin;
set local client_min_messages = warning;

-- No Data API role reaches the schema, and this module has no views.
do $$
begin
  if has_schema_privilege('anon', 'router_gateway', 'usage')
     or has_schema_privilege('authenticated', 'router_gateway', 'usage') then
    raise exception 'router_gateway is reachable by a Data API role';
  end if;
  if has_schema_privilege('nabvy_app', 'router_gateway', 'usage') then
    raise exception 'nabvy_app reaches router_gateway';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'router_gateway.%') then
    raise exception 'router_gateway views break the view conventions';
  end if;
end;
$$;

-- No coordinate column: the table has exactly these columns, and adding any other fails here.
do $$
declare
  found text;
begin
  select string_agg(column_name || ':' || data_type, ',' order by column_name) into found
  from information_schema.columns
  where table_schema = 'router_gateway';
  if found is distinct from
     'at:timestamp with time zone,build:text,id:uuid,kind:text,latency_ms:integer,'
     || 'location_count:integer,provider:text,status:text' then
    raise exception 'router_gateway columns changed (no coordinate may be stored): %', found;
  end if;
end;
$$;

-- The pipeline inserts and settles a call; it cannot rewrite what was sent or delete.
set local role nabvy_pipeline;
insert into router_gateway.router_calls (provider, kind, location_count, status)
values ('openrouteservice', 'table', 3, 'pending');
update router_gateway.router_calls set status = 'ok', latency_ms = 120, build = '2026-09-01';
do $$
begin
  begin
    update router_gateway.router_calls set location_count = 9;
    raise exception 'nabvy_pipeline rewrote location_count';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from router_gateway.router_calls;
    raise exception 'nabvy_pipeline deleted a call';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
