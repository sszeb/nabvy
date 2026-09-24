-- usage-ledger: allocation guards (review of PR #47, findings 2 and 3). Hand-written.
--
-- 1. A charge may not draw on an expired bucket, whoever writes it: the service only picks live
--    buckets, and now the trigger refuses it too.
-- 2. Every allocation re-checks its entry's balance at commit, not only an entry's own insert, so
--    an allocation added later to an already committed charge or expiry (which would debit a
--    bucket with no ledger entry) is refused.
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
    if entry.kind = 'charge' and bucket.expires_at is not null and bucket.expires_at <= now() then
      raise exception 'usage_ledger: bucket % has expired', new.bucket_id using errcode = '23514';
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

create or replace function usage_ledger.check_allocation_balanced() returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  entry_credits integer;
  allocated bigint;
begin
  select e.credits into entry_credits from usage_ledger.entries as e where e.id = new.entry_id;
  if not found then
    -- Deleted later in the same transaction (the purge): nothing left to balance.
    return null;
  end if;
  select coalesce(sum(a.credits), 0) into allocated
  from usage_ledger.allocations as a where a.entry_id = new.entry_id;
  if allocated <> entry_credits then
    raise exception 'usage_ledger: entry % moves % credits but its allocations move %',
      new.entry_id, entry_credits, allocated using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function usage_ledger.check_allocation_balanced() from public;
create constraint trigger allocations_balanced after insert on usage_ledger.allocations
  deferrable initially deferred
  for each row execute function usage_ledger.check_allocation_balanced();
