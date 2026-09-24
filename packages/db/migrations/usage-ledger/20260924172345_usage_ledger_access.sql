-- usage-ledger: grants, RLS, the triggers that keep buckets in step with the ledger, and the
-- internal view. Hand-written (packages/db/README.md).
--
-- Invariants the database holds whoever writes (services/usage-ledger/README.md, "Tables"):
--   * entries and allocations are append-only: no role may update them; only the pipeline may
--     delete them, for the account-deletion purge;
--   * no role writes buckets: a grant entry creates its bucket, and each allocation moves its
--     bucket's `remaining`, both through SECURITY DEFINER triggers, and `remaining` stays between
--     0 and the grant (a check constraint), so no charge can spend credit that is not there;
--   * a reversal mirrors exactly one charge of the same user, once, bucket by bucket;
--   * at commit, every charge, reversal and expiry has allocations adding up to its credits.
comment on schema usage_ledger is
  'Usage ledger: credit grants, charges, reversals and expiries, with a bucket per grant. Owner: the usage-ledger module.';
grant usage on schema usage_ledger to nabvy_app, nabvy_pipeline;

-- entries: the web app charges and reverses inside the user's own action (withUser); grants
-- (Stripe webhooks, monthly allowances, referral credit) and expiries run in the pipeline.
grant select, insert on usage_ledger.entries to nabvy_app;
select nabvy_core.enable_user_rls('usage_ledger.entries');
create policy app_charges_only on usage_ledger.entries as restrictive for insert to nabvy_app
  with check (kind in ('charge', 'reversal'));
select nabvy_core.allow_pipeline('usage_ledger.entries', 'select');
select nabvy_core.allow_pipeline('usage_ledger.entries', 'insert');
select nabvy_core.allow_pipeline('usage_ledger.entries', 'delete');
grant select, insert, delete on usage_ledger.entries to nabvy_pipeline;

-- buckets: read only. Written by the triggers below, which run as the table owner.
grant select on usage_ledger.buckets to nabvy_app;
select nabvy_core.enable_user_rls('usage_ledger.buckets');
select nabvy_core.allow_pipeline('usage_ledger.buckets', 'select');
select nabvy_core.allow_pipeline('usage_ledger.buckets', 'delete');
grant select, delete on usage_ledger.buckets to nabvy_pipeline;

-- allocations: written with their entry.
grant select, insert on usage_ledger.allocations to nabvy_app;
select nabvy_core.enable_user_rls('usage_ledger.allocations');
select nabvy_core.allow_pipeline('usage_ledger.allocations', 'select');
select nabvy_core.allow_pipeline('usage_ledger.allocations', 'insert');
select nabvy_core.allow_pipeline('usage_ledger.allocations', 'delete');
grant select, insert, delete on usage_ledger.allocations to nabvy_pipeline;

-- A grant entry opens its bucket; a reversal must mirror a charge of the same user.
create or replace function usage_ledger.on_entry_insert() returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  charged record;
begin
  if new.kind in ('allowance', 'taste', 'referral', 'topup') then
    insert into usage_ledger.buckets
      (id, user_id, kind, rank, credits, remaining, cash_minor, expires_at, created_at)
    values (
      new.id, new.user_id, new.kind,
      case new.kind when 'allowance' then 1 when 'topup' then 3 else 2 end,
      new.credits, new.credits, new.cash_minor, new.expires_at, new.at
    );
  elsif new.kind = 'reversal' then
    select e.user_id, e.kind, e.credits into charged
    from usage_ledger.entries as e where e.id = new.reverses_id;
    if not found or charged.kind <> 'charge' or charged.user_id <> new.user_id then
      raise exception 'usage_ledger: reversal % names no charge of user %', new.id, new.user_id
        using errcode = '23514';
    end if;
    if new.credits <> -charged.credits then
      raise exception 'usage_ledger: reversal % must return exactly % credits', new.id, -charged.credits
        using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function usage_ledger.on_entry_insert() from public;
create trigger entries_on_insert after insert on usage_ledger.entries
  for each row execute function usage_ledger.on_entry_insert();

-- Each allocation moves its bucket. A charge or expiry takes, a reversal gives back exactly what
-- its charge took from that bucket; the bucket's check constraint refuses an overdraw.
create or replace function usage_ledger.on_allocation_insert() returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  entry record;
  bucket record;
  taken integer;
begin
  select e.user_id, e.kind, e.reverses_id into entry
  from usage_ledger.entries as e where e.id = new.entry_id;
  if not found then
    raise exception 'usage_ledger: allocation names no entry %', new.entry_id using errcode = '23514';
  end if;
  select b.user_id, b.expires_at into bucket
  from usage_ledger.buckets as b where b.id = new.bucket_id;
  if not found or entry.user_id <> new.user_id or bucket.user_id <> new.user_id then
    raise exception 'usage_ledger: allocation (%, %) crosses users or names nothing',
      new.entry_id, new.bucket_id using errcode = '23514';
  end if;
  if entry.kind in ('charge', 'expiry') then
    if new.credits >= 0 then
      raise exception 'usage_ledger: a % allocation takes credit', entry.kind using errcode = '23514';
    end if;
    if entry.kind = 'expiry' and (bucket.expires_at is null or bucket.expires_at > now()) then
      raise exception 'usage_ledger: bucket % has not expired', new.bucket_id using errcode = '23514';
    end if;
  elsif entry.kind = 'reversal' then
    select a.credits into taken from usage_ledger.allocations as a
    where a.entry_id = entry.reverses_id and a.bucket_id = new.bucket_id;
    if taken is null or new.credits <> -taken then
      raise exception 'usage_ledger: reversal allocation on % must return %', new.bucket_id, -taken
        using errcode = '23514';
    end if;
  else
    raise exception 'usage_ledger: a % entry has no allocations', entry.kind using errcode = '23514';
  end if;
  update usage_ledger.buckets set remaining = remaining + new.credits where id = new.bucket_id;
  return new;
end;
$$;
revoke all on function usage_ledger.on_allocation_insert() from public;
create trigger allocations_on_insert before insert on usage_ledger.allocations
  for each row execute function usage_ledger.on_allocation_insert();

-- At commit: a charge, reversal or expiry's allocations add up to its credits. An entry deleted
-- later in the same transaction (the purge) is skipped.
create or replace function usage_ledger.check_entry_balanced() returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  allocated bigint;
begin
  if not exists (select 1 from usage_ledger.entries as e where e.id = new.id) then
    return null;
  end if;
  select coalesce(sum(a.credits), 0) into allocated
  from usage_ledger.allocations as a where a.entry_id = new.id;
  if allocated <> new.credits then
    raise exception 'usage_ledger: entry % moves % credits but its allocations move %',
      new.id, new.credits, allocated using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function usage_ledger.check_entry_balanced() from public;
create constraint trigger entries_balanced after insert on usage_ledger.entries
  deferrable initially deferred
  for each row when (new.kind in ('charge', 'reversal', 'expiry'))
  execute function usage_ledger.check_entry_balanced();

-- Internal view (rule 5): each user's balance now and the cost their charges caused. Expired
-- buckets count nothing, whether or not the expiry sweep has run. The cost of a reversed charge
-- still counts: the provider was paid (docs/design/pricing-model.md, "Failed actions reversed in
-- the ledger (Apify cost still booked)"). Rows only while the module is not off (rule 11).
-- Readers: subscriptions, lifecycle-messaging, the free-tier cap (4.9a). nabvy_pipeline only until
-- per-module roles exist.
create view usage_ledger.v_balances with (security_invoker = true) as
  with live as (
    select b.user_id, b.rank, b.remaining, b.cash_minor, b.expires_at
    from usage_ledger.buckets as b
    where b.remaining > 0 and (b.expires_at is null or b.expires_at > now())
  ),
  costs as (
    select e.user_id, sum(e.cost_gbp_micros)::bigint as cost
    from usage_ledger.entries as e where e.kind = 'charge' group by e.user_id
  ),
  users as (
    select b.user_id from usage_ledger.buckets as b
    union
    select c.user_id from costs as c
  )
  select u.user_id,
         coalesce(sum(l.remaining), 0)::integer as credits,
         coalesce(sum(l.remaining) filter (where l.rank = 1), 0)::integer as allowance_credits,
         coalesce(sum(l.remaining) filter (where l.rank = 2), 0)::integer as taste_referral_credits,
         coalesce(sum(l.remaining) filter (where l.rank = 3), 0)::integer as topup_credits,
         coalesce(sum(l.remaining) filter (where l.cash_minor > 0), 0)::integer as funding_credits,
         min(l.expires_at) as next_expiry_at,
         coalesce(max(c.cost), 0)::bigint as attributed_cost_gbp_micros
  from users as u
  left join live as l on l.user_id = u.user_id
  left join costs as c on c.user_id = u.user_id
  where switches.state('usage-ledger') <> 'off'
  group by u.user_id;
revoke all on usage_ledger.v_balances from public;
grant select on usage_ledger.v_balances to nabvy_pipeline;
