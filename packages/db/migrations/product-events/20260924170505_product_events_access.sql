-- product-events: replaces the plain table the previous migration generated with the real,
-- monthly range-partitioned shape (docs/contracts.md:185; packages/db/src/schema/product-events.ts),
-- then ownership, append-only enforcement, partitions, grants and the internal view. Hand-written
-- (docs/engineering.md:30, "partitions ... are hand-written SQL migrations").
comment on schema product_events is
  'Product events: first-party product analytics (docs/analytics.md). Owner: the product-events module.';
revoke all on schema product_events from public;

drop table product_events.events;

create table product_events.events (
  id uuid not null default nabvy_core.uuidv7(),
  user_id uuid not null,
  event text not null,
  properties jsonb not null default '{}'::jsonb,
  session_id text,
  at timestamp (3) with time zone not null default now(),
  primary key (id, at)
) partition by range (at);

-- Every event, for internal readers (rule 5 of docs/design/modules/_rules.md), by the columns
-- docs/contracts.md:190 requires an index on: event and userId, each with `at desc`.
create index events_event_at_idx on product_events.events (event, at desc);
create index events_user_id_at_idx on product_events.events (user_id, at desc);

-- Append-only, the audit_log.entries pattern (packages/db/migrations/audit-log/..._access.sql):
-- no role is granted update or delete, and these triggers refuse both (and truncate) even for
-- the table owner, so a row can only be removed by dropping the trigger in a reviewed migration.
create function product_events.refuse_change() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'product_events.events is append-only: % refused', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function product_events.refuse_change() from public;

create trigger events_append_only
  before update or delete on product_events.events
  for each row execute function product_events.refuse_change();
create trigger events_no_truncate
  before truncate on product_events.events
  for each statement execute function product_events.refuse_change();

-- Creates the monthly partition for `for_date`'s month if it does not already exist yet, so the
-- events table always has a partition ready for the current and near-future months. Called below
-- for an initial window; keeping it called ahead of `now()` on an ongoing basis (a scheduled job)
-- is not yet wired (services/product-events/README.md, "Not yet: partition rotation";
-- docs/questions/product-events.md).
create function product_events.ensure_month_partition(for_date date) returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  start_ts timestamptz := date_trunc('month', for_date);
  end_ts timestamptz := start_ts + interval '1 month';
  partition_name text := 'events_' || to_char(start_ts, 'YYYY_MM');
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'product_events' and c.relname = partition_name
  ) then
    execute format(
      'create table product_events.%I partition of product_events.events for values from (%L) to (%L)',
      partition_name, start_ts, end_ts
    );
  end if;
end;
$$;
revoke all on function product_events.ensure_month_partition(date) from public;

-- A catch-all partition so a write is never refused for lack of a monthly partition: it only
-- ever holds rows that fall outside the initial window below or a later rotation gap.
create table product_events.events_default partition of product_events.events default;

-- Initial partitions: one month back through three months ahead of whenever this migration is
-- applied, so writes land in a real monthly partition rather than the default one from day one.
do $$
declare
  offset_months int;
begin
  for offset_months in -1..3 loop
    perform product_events.ensure_month_partition(
      (date_trunc('month', now()) + (offset_months || ' months')::interval)::date
    );
  end loop;
end;
$$;

-- Writers. track() (services/product-events) validates the event name and its properties against
-- the ProductEventsEvent allowlist before this is ever reached (docs/analytics.md:15, "Properties
-- never include listing text, seller data or free-text input"). The web app records only the
-- signed-in caller's own events, inside withUser(userId); pipeline tasks record for whichever
-- user the event belongs to (for example a delivered alert).
grant usage on schema product_events to nabvy_app, nabvy_pipeline;
grant insert on product_events.events to nabvy_app, nabvy_pipeline;
select nabvy_core.enable_user_rls('product_events.events');
select nabvy_core.allow_pipeline('product_events.events', 'insert');

-- The internal read interface (rule 5 of docs/design/modules/_rules.md): every event, while the
-- module's switch is not off (rule 11). Granted to nabvy_pipeline until a module declares
-- product-events as a dependency and gets its own role (packages/db/README.md).
grant select on product_events.events to nabvy_pipeline;
select nabvy_core.allow_pipeline('product_events.events', 'select');
create view product_events.v_events with (security_invoker = true) as
  select id, user_id, event, properties, session_id, at
  from product_events.events
  where switches.state('product-events') <> 'off';
revoke all on product_events.v_events from public;
grant select on product_events.v_events to nabvy_pipeline;
