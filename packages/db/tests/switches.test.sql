-- switches: grants, fail-closed reads, the always-on rule, gates and a sample view. Rolled back.
begin;
set local client_min_messages = warning;

-- Grants: the pipeline reads and writes the table, never deletes; the web app only calls the
-- functions; anon and authenticated reach nothing; PUBLIC cannot execute the functions.
do $$
declare
  r text;
  f text;
begin
  if not (has_table_privilege('nabvy_pipeline', 'switches.switches', 'select')
          and has_table_privilege('nabvy_pipeline', 'switches.switches', 'insert')
          and has_table_privilege('nabvy_pipeline', 'switches.switches', 'update')
          and has_table_privilege('nabvy_pipeline', 'switches.v_state', 'select')) then
    raise exception 'nabvy_pipeline lacks its switches grants';
  end if;
  if has_table_privilege('nabvy_pipeline', 'switches.switches', 'delete')
     or has_table_privilege('nabvy_pipeline', 'switches.switches', 'truncate') then
    raise exception 'nabvy_pipeline can delete switches';
  end if;
  foreach f in array array['switches.state(text)', 'switches.is_on(text)', 'switches.gate_allows(text, uuid)'] loop
    foreach r in array array['nabvy_app', 'nabvy_pipeline'] loop
      if not has_function_privilege(r, f, 'execute') then
        raise exception '% cannot execute %', r, f;
      end if;
    end loop;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception '% is executable by PUBLIC', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '% is not SECURITY DEFINER', f;
    end if;
  end loop;
  if has_table_privilege('nabvy_app', 'switches.switches', 'select')
     or has_table_privilege('nabvy_app', 'switches.switches', 'update')
     or has_table_privilege('nabvy_app', 'switches.v_state', 'select') then
    raise exception 'nabvy_app can read or write switches directly';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'switches', 'usage') then
      raise exception '% can use schema switches', r;
    end if;
  end loop;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'switches.%') then
    raise exception 'switches.v_state breaks the view rules';
  end if;
end;
$$;

-- Seeds and fail-closed reads.
do $$
begin
  if switches.state('no-such-switch') <> 'off' or switches.is_on('no-such-switch')
     or switches.gate_allows('no-such-gate', '00000000-0000-4000-8000-0000000000c1') then
    raise exception 'an unknown switch does not read off';
  end if;
  if not (switches.is_on('switches') and switches.is_on('audit-log') and switches.is_on('incidents')) then
    raise exception 'an always-on module is not seeded on';
  end if;
  if switches.state('cost-meter') <> 'off' or switches.state('apify') <> 'off' then
    raise exception 'a seeded module or provider is not off';
  end if;
  if not switches.gate_allows('facebook-alerts', '00000000-0000-4000-8000-0000000000c1')
     or switches.gate_allows('facebook-alerts', null) then
    raise exception 'the open alert gate is wrong';
  end if;
end;
$$;

-- The always-on rule, shadow for modules only, allow-lists for gates only.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$update switches.switches set state = 'off' where name = 'audit-log'$q$,
    $q$update switches.switches set state = 'shadow' where name = 'switches'$q$,
    $q$update switches.switches set state = 'shadow' where name = 'apify'$q$,
    $q$update switches.switches set allow_list = array['00000000-0000-4000-8000-0000000000c1'::uuid] where name = 'pipeline'$q$,
    $q$insert into switches.switches (name, kind, state) values ('Bad Name', 'flag', 'on')$q$
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

-- A gate with an allow-list admits only its users.
update switches.switches set allow_list = array['00000000-0000-4000-8000-0000000000c1'::uuid]
  where name = 'facebook-alerts';
do $$
begin
  if not switches.gate_allows('facebook-alerts', '00000000-0000-4000-8000-0000000000c1')
     or switches.gate_allows('facebook-alerts', '00000000-0000-4000-8000-0000000000c2') then
    raise exception 'the allow-list is not applied';
  end if;
end;
$$;

-- The functions inside a sample reader view, as the web app.
create schema switches_sample;
create table switches_sample.items (id int primary key);
insert into switches_sample.items values (1), (2);
create view switches_sample.v_items with (security_invoker = true) as
  select id from switches_sample.items where switches.is_on('switches-sample');
grant usage on schema switches_sample to nabvy_app;
grant select on switches_sample.items, switches_sample.v_items to nabvy_app;
set local role nabvy_app;
do $$
begin
  if (select count(*) from switches_sample.v_items) <> 0 then
    raise exception 'an unknown module''s view returns rows';
  end if;
end;
$$;
reset role;
insert into switches.switches (name, kind, state) values ('switches-sample', 'module', 'on');
set local role nabvy_app;
do $$
begin
  if (select count(*) from switches_sample.v_items) <> 2 then
    raise exception 'an on module''s view returns no rows';
  end if;
end;
$$;
reset role;

rollback;
