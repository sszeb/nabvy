-- switches: the read functions, grants, the internal view and the seed rows. Hand-written.
comment on schema switches is
  'Switches: the state of every module, provider, gate, feature flag and the global pipeline pause. Owner: the switches module. Internal; not exposed to the Data API.';
revoke all on schema switches from public;
revoke all on switches.switches from public;

-- Read functions for views and code (rule 5 of docs/design/modules/_rules.md). SECURITY DEFINER,
-- so a reader needs EXECUTE only, never a grant on the table. Fail closed: a name with no row
-- reads 'off', and a gate with no row, switched off, or whose allow-list lacks the user is closed.
create or replace function switches.state(switch_name text) returns text
language sql stable security definer
set search_path = pg_catalog
as $$
  select coalesce((select s.state from switches.switches as s where s.name = switch_name), 'off')
$$;

-- The parameter is named m to match the stub in packages/db/tests/quote-redaction.test.sql,
-- which replaces this function with `create or replace` (that cannot rename a parameter).
create or replace function switches.is_on(m text) returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select switches.state(m) = 'on'
$$;

create or replace function switches.gate_allows(gate text, user_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select coalesce(
    (
      select s.state = 'on' and user_id is not null
             and (s.allow_list is null or user_id = any (s.allow_list))
      from switches.switches as s
      where s.name = gate and s.kind = 'gate'
    ),
    false
  )
$$;

-- Postgres grants EXECUTE on every new function to PUBLIC; only the application roles call these.
revoke all on function switches.state(text), switches.is_on(text), switches.gate_allows(text, uuid)
  from public;
grant usage on schema switches to nabvy_app, nabvy_pipeline;
grant execute on function switches.state(text), switches.is_on(text), switches.gate_allows(text, uuid)
  to nabvy_app, nabvy_pipeline;

-- Writers. Only an admin changes a switch, through services/switches' set(), which records the
-- change in audit_log in the same transaction. The database has no admin check for nabvy_app yet
-- (docs/questions.md, switches), so writes run as the pipeline only; the admin procedure checks
-- the session and calls set() inside withPipeline. No role may delete a row: a switch is turned
-- off, never removed.
grant select, insert, update on switches.switches to nabvy_pipeline;
select nabvy_core.allow_pipeline('switches.switches', 'select');
select nabvy_core.allow_pipeline('switches.switches', 'insert');
select nabvy_core.allow_pipeline('switches.switches', 'update');

-- The internal read interface: every switch, for the admin screen and internal readers.
create view switches.v_state with (security_invoker = true) as
  select name, kind, state, allow_list, changed_at, changed_by from switches.switches;
revoke all on switches.v_state from public;
grant select on switches.v_state to nabvy_pipeline;

-- Seed rows (changed_by null). Modules already built or in review: the three that cannot be
-- switched off are 'on'; auth is 'on' because it is live and "if auth is off, nobody signs in";
-- every other module starts 'off' (rule 11). Providers start 'off' until an admin turns them on
-- (docs/questions.md, switches). The Facebook alert gate is open to all (question 25): 'on' with
-- no allow-list. The pipeline is not paused. Flags start 'off' (listing-photos: decisions.md:94).
insert into switches.switches (name, kind, state) values
  ('switches', 'module', 'on'),
  ('audit-log', 'module', 'on'),
  ('incidents', 'module', 'on'),
  ('auth', 'module', 'on'),
  ('cost-meter', 'module', 'off'),
  ('quote-redaction', 'module', 'off'),
  ('apify', 'provider', 'off'),
  ('anthropic', 'provider', 'off'),
  ('ebay', 'provider', 'off'),
  ('cex', 'provider', 'off'),
  ('facebook-alerts', 'gate', 'on'),
  ('listing-photos', 'flag', 'off'),
  ('pipeline', 'global', 'on')
on conflict (name) do nothing;
