-- Better Auth tables and the founder seed. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  changed integer;
  admins integer;
begin
  changed := better_auth.seed_founders(array['Founder@Example.com ', 'founder@example.com', 'second@example.com']);
  if changed <> 2 then raise exception 'seed inserted %, expected 2', changed; end if;
  -- Idempotent: a second run changes nothing.
  changed := better_auth.seed_founders(array['founder@example.com', 'second@example.com']);
  if changed <> 0 then raise exception 'second seed changed % rows, expected 0', changed; end if;
  -- An existing non-admin is promoted.
  insert into better_auth."user" (name, email) values ('', 'staff@example.com');
  changed := better_auth.seed_founders(array['staff@example.com']);
  if changed <> 1 then raise exception 'promotion changed % rows, expected 1', changed; end if;
  select count(*) into admins from better_auth."user" where role = 'admin';
  if admins <> 3 then raise exception '% admins, expected 3', admins; end if;
  -- IDs are database-generated UUIDs.
  if exists (select 1 from better_auth."user" where id is null) then raise exception 'null user id'; end if;
  begin
    perform better_auth.seed_founders(array[]::text[]);
    raise exception 'empty ADMIN_EMAILS accepted';
  exception when raise_exception then
    if sqlerrm not like 'seed_founders:%' then raise; end if;
  end;
end;
$$;

-- No application role reaches the auth tables until task 4.0 grants it.
do $$
begin
  if has_schema_privilege('nabvy_app', 'better_auth', 'usage')
     or has_schema_privilege('nabvy_pipeline', 'better_auth', 'usage') then
    raise exception 'an application role can use better_auth before task 4.0 decides';
  end if;
end;
$$;

rollback;
