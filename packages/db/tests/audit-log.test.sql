-- audit-log: append-only grants, one row per insert, the actor policy and the admin view. Rolled back.
begin;
set local client_min_messages = warning;

-- Grants: insert only, for the web app and the pipeline; no update, delete, truncate or select;
-- the view is granted to no application role; anon and authenticated reach nothing.
do $$
declare
  r text;
begin
  foreach r in array array['nabvy_app', 'nabvy_pipeline'] loop
    if not has_table_privilege(r, 'audit_log.entries', 'insert') then
      raise exception '% cannot insert into audit_log.entries', r;
    end if;
    if has_table_privilege(r, 'audit_log.entries', 'select')
       or has_table_privilege(r, 'audit_log.entries', 'update')
       or has_table_privilege(r, 'audit_log.entries', 'delete')
       or has_table_privilege(r, 'audit_log.entries', 'truncate')
       or has_table_privilege(r, 'audit_log.v_entries', 'select') then
      raise exception '% has more than insert on the audit log', r;
    end if;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'audit_log', 'usage') then
      raise exception '% can use schema audit_log', r;
    end if;
  end loop;
  if has_function_privilege('nabvy_app', 'audit_log.refuse_change()', 'execute') then
    raise exception 'audit_log.refuse_change() is executable by the app';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'audit_log.%') then
    raise exception 'audit_log.v_entries breaks the view rules';
  end if;
end;
$$;

-- One row per call, as the web app inside withUser and as the pipeline.
do $$ begin perform set_config('app.user_id', '00000000-0000-4000-8000-0000000000a1', true); end; $$;
set local role nabvy_app;
insert into audit_log.entries (id, actor_user_id, action, target, before, after)
  values ('01920000-0000-7000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1',
          'auth.role-changed', 'user:00000000-0000-4000-8000-0000000000b2',
          '{"role":"user"}', '{"role":"admin"}');
reset role;
set local role nabvy_pipeline;
insert into audit_log.entries (id, actor_user_id, action, target, reason)
  values ('01920000-0000-7000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000a1',
          'audit-log.restricted-read', 'view:apify_gateway.v_restricted_rows', 'scam report 42');
reset role;
do $$
begin
  if (select count(*) from audit_log.v_entries
      where id in ('01920000-0000-7000-8000-0000000000f1', '01920000-0000-7000-8000-0000000000f2')) <> 2 then
    raise exception 'expected exactly two rows';
  end if;
end;
$$;

-- Refusals: another actor from the app; update, delete and truncate even as the owner; a
-- restricted read without a reason.
do $$
declare
  refused boolean;
  probe record;
begin
  for probe in
    select * from (values
      ('nabvy_app', $q$insert into audit_log.entries (actor_user_id, action, target) values ('00000000-0000-4000-8000-0000000000b2', 'auth.role-changed', 'user:1')$q$),
      ('nabvy_app', $q$update audit_log.entries set reason = 'x'$q$),
      ('nabvy_pipeline', $q$delete from audit_log.entries$q$),
      ('', $q$update audit_log.entries set reason = 'x'$q$),
      ('', $q$delete from audit_log.entries$q$),
      ('', $q$truncate audit_log.entries$q$),
      ('', $q$insert into audit_log.entries (actor_user_id, action, target) values ('00000000-0000-4000-8000-0000000000a1', 'audit-log.restricted-read', 'view:x.v_restricted_y')$q$)
    ) as probes (role_name, statement)
  loop
    refused := false;
    begin
      if probe.role_name <> '' then
        execute format('set local role %I', probe.role_name);
      end if;
      execute probe.statement;
    exception when others then
      refused := true;
    end;
    execute 'reset role';
    if not refused then
      raise exception 'not refused (%): %', probe.role_name, probe.statement;
    end if;
  end loop;
end;
$$;

rollback;
