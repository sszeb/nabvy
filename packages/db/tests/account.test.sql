-- account: grants, RLS isolation, the standing constraints and the internal views. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
begin
  -- The user's own tables: nabvy_app read/writes; deletion_requests and telegram_link_codes have
  -- no user-facing update (services/account/README.md).
  if not (has_table_privilege('nabvy_app', 'account.user_profiles', 'select')
          and has_table_privilege('nabvy_app', 'account.user_profiles', 'update')
          and has_table_privilege('nabvy_app', 'account.telegram_links', 'delete')
          and has_table_privilege('nabvy_app', 'account.telegram_link_codes', 'insert')
          and has_table_privilege('nabvy_app', 'account.push_subscriptions', 'delete')
          and has_table_privilege('nabvy_app', 'account.deletion_requests', 'insert')
          and has_table_privilege('nabvy_app', 'account.api_keys', 'delete')) then
    raise exception 'nabvy_app lacks its account grants';
  end if;
  if has_table_privilege('nabvy_app', 'account.telegram_link_codes', 'update') then
    raise exception 'nabvy_app can update a link code directly (only the bot callback may)';
  end if;
  -- standing: nabvy_pipeline only, never deleted.
  if not (has_table_privilege('nabvy_pipeline', 'account.standing', 'select')
          and has_table_privilege('nabvy_pipeline', 'account.standing', 'insert')
          and has_table_privilege('nabvy_pipeline', 'account.standing', 'update')) then
    raise exception 'nabvy_pipeline lacks its standing grants';
  end if;
  if has_table_privilege('nabvy_app', 'account.standing', 'select')
     or has_table_privilege('nabvy_pipeline', 'account.standing', 'delete') then
    raise exception 'standing is reachable outside setStanding()''s own writers';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'account', 'usage') then
      raise exception '% can use schema account', r;
    end if;
  end loop;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'account.%') then
    raise exception 'an account view breaks the view rules';
  end if;
end;
$$;

-- The standing constraints: a suspension needs an until date; a ban or active row must not carry
-- one (packages/db/src/schema/account.ts).
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into account.standing (user_id, status) values ('00000000-0000-4000-8000-0000000000a1', 'suspended')$q$,
    $q$insert into account.standing (user_id, status, until) values ('00000000-0000-4000-8000-0000000000a2', 'banned', now())$q$,
    $q$insert into account.standing (user_id, status, until) values ('00000000-0000-4000-8000-0000000000a3', 'active', now())$q$,
    $q$insert into account.standing (user_id, status) values ('00000000-0000-4000-8000-0000000000a4', 'gone')$q$
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

-- RLS isolation: a user reads and writes only their own profile through nabvy_app.
insert into account.user_profiles (user_id, display_name) values
  ('00000000-0000-4000-8000-0000000000b1', 'Alex'),
  ('00000000-0000-4000-8000-0000000000b2', 'Bo');
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
do $$
begin
  if (select count(*) from account.user_profiles) <> 1 then
    raise exception 'nabvy_app sees another user''s profile';
  end if;
  if (select display_name from account.user_profiles
      where user_id = '00000000-0000-4000-8000-0000000000b1') <> 'Alex' then
    raise exception 'nabvy_app cannot read its own profile';
  end if;
  update account.user_profiles set display_name = 'Alexa'
    where user_id = '00000000-0000-4000-8000-0000000000b2';
  if found then
    raise exception 'nabvy_app updated another user''s profile';
  end if;
end;
$$;
reset role;

-- The internal views carry no switches filter (rule 11): they return rows whatever
-- switches.state('account') is, including when no row exists (fails closed to 'off' already).
insert into account.telegram_links (user_id, chat_id) values
  ('00000000-0000-4000-8000-0000000000b1', 'chat-1');
insert into account.standing (user_id, status) values
  ('00000000-0000-4000-8000-0000000000b1', 'active');
set local role nabvy_pipeline;
do $$
begin
  if switches.state('account') <> 'off' then
    raise exception 'test assumption broken: account should have no switches row yet';
  end if;
  if (select count(*) from account.v_channels
      where user_id = '00000000-0000-4000-8000-0000000000b1' and kind = 'telegram') <> 1 then
    raise exception 'v_channels is filtered by the account switch';
  end if;
  if (select count(*) from account.v_standing
      where user_id = '00000000-0000-4000-8000-0000000000b1') <> 1 then
    raise exception 'v_standing is filtered by the account switch';
  end if;
end;
$$;
reset role;

rollback;
