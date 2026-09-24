-- Behaviour tests for the apify_gateway schema: input validation, cost reservation, the spend cap,
-- cost settlement, redaction and privileges. Runs inside one transaction that is rolled back, on a
-- throwaway database only (scripts/db-dry-run.sh). Any failed check raises and stops the run.
\set ON_ERROR_STOP 1
\o /dev/null
begin;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAILED: %', what;
  end if;
end;
$$;

delete from apify_gateway.items;
delete from apify_gateway.jobs;

-- 1. enqueue_run rejects every input the gateway must refuse, and accepts a valid one.
do $$
declare
  good jsonb := '{"inputVersion":3,"searchTerms":["gaming pc"],"cityId":"115935195086622",
    "maxRequests":60,"maxRunSeconds":240,"browserFallback":false,"useDetailCache":false,
    "proxyConfiguration":{"useApifyProxy":true,"apifyProxyGroups":["RESIDENTIAL"],"apifyProxyCountry":"GB"}}';
  proxy jsonb := good -> 'proxyConfiguration';
  bad record;
  rejected integer := 0;
begin
  for bad in select * from (values
    (good, 3000, 300, 'memory not allowed', 'memory must'),
    (good, 1024, 30, 'timeout below 60 s', 'timeout must be between'),
    (good, 1024, 1801, 'timeout above 1800 s', 'timeout must be between'),
    (good - 'maxRequests', 1024, 300, 'maxRequests missing', 'maxRequests is required'),
    (good || '{"maxRequests":1001}', 1024, 300, 'maxRequests above 1000', 'maxRequests is required'),
    (good || '{"maxRunSeconds":900}', 1024, 300, 'maxRunSeconds above timeout', 'timeout must be at least'),
    (good || '{"startUrls":["https://www.facebook.com/marketplace/"]}', 1024, 300, 'startUrls', 'startUrls is not allowed'),
    (good || '{"browserFallback":true}', 1024, 300, 'browserFallback true', 'browserFallback'),
    (good - 'browserFallback', 1024, 300, 'browserFallback missing', 'browserFallback'),
    (good - 'proxyConfiguration', 1024, 300, 'proxyConfiguration missing', 'proxyConfiguration must'),
    (good || '{"inputVersion":2}', 1024, 300, 'inputVersion 2', 'inputVersion must be 3'),
    -- Hardening (20260924030000).
    (good, 1024, 240, 'timeout equal to maxRunSeconds', 'timeout must be at least'),
    (good, 1024, 299, 'timeout under maxRunSeconds + 60 s', 'timeout must be at least'),
    (good || '{"useDetailCache":true}', 1024, 300, 'useDetailCache true', 'useDetailCache'),
    (good - 'useDetailCache', 1024, 300, 'useDetailCache missing', 'useDetailCache'),
    (good || jsonb_build_object('proxyConfiguration', proxy - 'apifyProxyCountry'), 1024, 300, 'proxy without country', 'proxyConfiguration must'),
    (good || jsonb_build_object('proxyConfiguration', proxy || '{"apifyProxyCountry":"IE"}'), 1024, 300, 'proxy country IE', 'proxyConfiguration must'),
    (good || jsonb_build_object('proxyConfiguration', proxy || '{"apifyProxyGroups":["DATACENTER"]}'), 1024, 300, 'datacenter proxy', 'proxyConfiguration must'),
    (good || jsonb_build_object('proxyConfiguration', proxy || '{"useApifyProxy":false}'), 1024, 300, 'Apify proxy off', 'proxyConfiguration must'),
    (good || '{"maxRequests":"60"}', 1024, 300, 'maxRequests as a string', 'maxRequests must be a JSON integer'),
    (good || '{"maxRunSeconds":"240"}', 1024, 300, 'maxRunSeconds as a string', 'maxRunSeconds must be a JSON integer'),
    (good || '{"inputVersion":"3"}', 1024, 300, 'inputVersion as a string', 'inputVersion must be a JSON integer'),
    (good || '{"maxListings":"20"}', 1024, 300, 'maxListings as a string', 'maxListings must be a JSON integer'),
    (good || '{"maxPagesPerSearch":1.5}', 1024, 300, 'maxPagesPerSearch not an integer', 'maxPagesPerSearch must be a JSON integer'),
    (good || '{"listingIds":["1234567890123456"]}', 1024, 300, 'searches and listingIds together', 'not both'),
    ('[]'::jsonb, 1024, 300, 'input not an object', 'JSON object')
  ) as t (input, memory, timeout, label, expected) loop
    begin
      perform apify_gateway.enqueue_run(bad.input, bad.memory, bad.timeout, bad.label);
      raise exception 'NOT REJECTED: %', bad.label;
    exception when others then
      if sqlerrm like 'NOT REJECTED%' then
        raise;
      end if;
      -- Refused by the intended rule, not by some other error.
      if position(bad.expected in sqlerrm) = 0 then
        raise exception 'WRONG REASON for %: %', bad.label, sqlerrm;
      end if;
      rejected := rejected + 1;
    end;
  end loop;
  perform pg_temp.check(rejected = 26, 'all 26 invalid inputs rejected');
  perform pg_temp.check(apify_gateway.enqueue_run(good, 1024, 300, 'valid') is not null, 'valid input accepted');
  -- A detail batch alone, and searches with an empty listingIds, are accepted.
  perform pg_temp.check(apify_gateway.enqueue_run(
    good - 'searchTerms' - 'cityId' || '{"listingIds":["1234567890123456"]}', 1024, 300, 'detail batch') is not null,
    'listingIds alone accepted');
  perform pg_temp.check(apify_gateway.enqueue_run(
    good || '{"listingIds":[]}', 1024, 300, 'empty ids') is not null, 'searches with empty listingIds accepted');
  delete from apify_gateway.jobs where note in ('detail batch', 'empty ids');
end;
$$;

-- 2. The reservation is the worst case: 1 GB x 300 s at $0.40/CU, plus 60 requests x 0.5 MB at
--    $10/GB, plus $0.01.
select pg_temp.check(reserve_usd = 0.3363, 'reservation for 1024 MB, 300 s, 60 requests is $0.3363')
from apify_gateway.jobs where note = 'valid';

-- 3. Jobs are claimed oldest first; a claimed run counts at its reservation; runs that would pass
--    the cap are refused.
insert into apify_gateway.jobs (kind, note) values ('env_check', 'free job');
select pg_temp.check(kind = 'run' and status = 'running', 'oldest job (the run) is claimed first')
from apify_gateway.claim_next_job();
select pg_temp.check(kind = 'env_check' and status = 'running', 'free job claimed next')
from apify_gateway.claim_next_job();
select pg_temp.check(committed_usd = 0.3363, 'a running job counts at its reservation')
from apify_gateway.spend;

select apify_gateway.enqueue_run(
  '{"inputVersion":3,"maxRequests":1000,"maxRunSeconds":1740,"browserFallback":false,"useDetailCache":false,
    "proxyConfiguration":{"useApifyProxy":true,"apifyProxyGroups":["RESIDENTIAL"],"apifyProxyCountry":"GB"}}',
  2048, 1800, 'big');
select pg_temp.check(reserve_usd = 5.2928, 'worst-case reservation for a maximal run is $5.2928')
from apify_gateway.jobs where note = 'big';
select pg_temp.check(status = 'refused' and error like 'spend cap:%', 'a run past the $5.50 cap is refused')
from apify_gateway.claim_next_job();
select pg_temp.check(count(*) = 0, 'nothing left to claim') from apify_gateway.claim_next_job();

-- 4. A finished run counts at the larger of its provisional cost and its reservation until settled.
update apify_gateway.jobs
set status = 'succeeded', apify_run_id = 'TestRunId00000001', cost_usd = 0.0003
where note = 'valid';
select pg_temp.check(committed_usd = 0.3363, 'an unsettled finished run still counts at its reservation')
from apify_gateway.spend;
update apify_gateway.jobs set cost_usd = 0.0177, settled_at = now() where note = 'valid';
select pg_temp.check(committed_usd = 0.0177, 'a settled run counts at its settled cost')
from apify_gateway.spend;

-- 4b. `collect` jobs re-download a finished run for free: never refused by the cap, never counted.
update apify_gateway.jobs set status = 'failed' where status = 'pending';
insert into apify_gateway.jobs (kind, input, note)
values ('collect', '{"apifyRunId":"TestRunId00000001"}', 'collect');
update apify_gateway.settings set cap_usd = 0;
select pg_temp.check(kind = 'collect' and status = 'running', 'a collect job is claimed even at a zero cap')
from apify_gateway.claim_next_job();
update apify_gateway.settings set cap_usd = 5.50;
select pg_temp.check(committed_usd = 0.0177, 'a collect job adds nothing to committed spend')
from apify_gateway.spend;
select pg_temp.check(download_page_size = 1000, 'datasets download in pages of 1,000 rows by default')
from apify_gateway.settings;
do $$
begin
  begin
    update apify_gateway.settings set download_page_size = 0;
    raise exception 'NOT REJECTED: page size 0';
  exception when check_violation then
    null;
  end;
end;
$$;

-- 5. Redaction.
insert into apify_gateway.jobs (kind, note) values ('env_check', 'redaction');
insert into apify_gateway.items (job_id, seq, item)
select id, 0, $json${
  "recordType": "listing",
  "listingId": "1111222233334444",
  "listingUrl": "https://www.facebook.com/marketplace/item/1111222233334444/",
  "title": "RTX 3080 GTX 970 B450 TOMAHAWK AX210 SP850 V2 CL40 2x16gb",
  "description": "Call 07700 900123 or 01234 567890, email jo.bloggs@example.co.uk, insta @jo_builds, wa.me/447700900123 see https://www.facebook.com/jo.bloggs.77 photo https://scontent-lhr8-1.xx.fbcdn.net/v/t45/abc.jpg?x=1 BH16 5BN; E1 (Whitechapel) fine; USB 2.0 PORTS @ BACK PANEL",
  "imageUrl": "https://scontent-lhr8-1.xx.fbcdn.net/v/t45/abc.jpg?x=1",
  "photoUrls": ["https://scontent-lhr8-1.xx.fbcdn.net/v/t45/abc.jpg?x=1"],
  "seller": {"id": "100012345678901", "name": "Jo Bloggs", "short_name": "Jo",
             "profile_picture": {"url": "https://scontent.xx.fbcdn.net/v/p/jo.jpg"}},
  "provenance": {"seller": "detail"},
  "sourceFields": {
    "search": {"marketplace_listing_seller": {"__typename": "User", "id": "AbCdEfGhToken",
      "name": "Jo Bloggs", "join_time": 1600000000, "is_verified": false,
      "badges": [{"label": "Very responsive", "icon": {"uri": "https://static.xx.fbcdn.net/b.png"}}]}},
    "detail": {"marketplace_listing_seller": null}
  }
}$json$::jsonb
from apify_gateway.jobs where note = 'redaction';

do $$
declare
  r jsonb;
  job integer := (select id from apify_gateway.jobs where note = 'redaction');
  card jsonb;
begin
  select item into r from apify_gateway.redacted_items(job) where seq = 0;
  card := r #> '{sourceFields,search,marketplace_listing_seller}';

  perform pg_temp.check(r #>> '{seller,id}' = '900000000000001', 'numeric seller ID becomes a same-length numeric placeholder');
  perform pg_temp.check(r #>> '{seller,name}' = '[redacted]', 'seller name redacted');
  perform pg_temp.check(r #>> '{seller,short_name}' = '[redacted]', 'seller short_name redacted');
  perform pg_temp.check(r #>> '{seller,profile_picture,url}' like 'https://redacted.invalid/%', 'seller picture url redacted');
  perform pg_temp.check(card ->> 'id' = 'redacted-token-1', 'token seller ID becomes a token placeholder');
  perform pg_temp.check(card ->> '__typename' = 'User', '__typename kept');
  perform pg_temp.check(card ->> 'join_time' = '[redacted]' and card ->> 'is_verified' = '[redacted]', 'unknown card keys redacted');
  perform pg_temp.check(card #>> '{badges,0,icon,uri}' like 'https://redacted.invalid/%', 'nested seller URL redacted');
  perform pg_temp.check(r #> '{sourceFields,detail,marketplace_listing_seller}' = 'null'::jsonb, 'null seller stays null');
  perform pg_temp.check(r #>> '{provenance,seller}' = 'detail', 'provenance string named seller untouched');

  perform pg_temp.check(r ->> 'imageUrl' like 'https://redacted.invalid/media/%.jpg', 'media URL replaced');
  perform pg_temp.check(r ->> 'imageUrl' = r #>> '{photoUrls,0}', 'the same photo gets the same placeholder');
  perform pg_temp.check(r ->> 'listingUrl' = 'https://www.facebook.com/marketplace/item/1111222233334444/', 'marketplace item URL kept');
  perform pg_temp.check(r ->> 'title' = 'RTX 3080 GTX 970 B450 TOMAHAWK AX210 SP850 V2 CL40 2x16gb', 'hardware model text untouched');

  perform pg_temp.check(r ->> 'description' not like '%07700%' and r ->> 'description' not like '%01234 567890%', 'phone numbers masked');
  perform pg_temp.check(r ->> 'description' like '%[email redacted]%', 'email masked');
  perform pg_temp.check(r ->> 'description' like '%@[handle redacted]%', 'social handle masked');
  perform pg_temp.check(r ->> 'description' like '%[link redacted]%', 'messaging link masked');
  perform pg_temp.check(r ->> 'description' like '%https://redacted.invalid/facebook%', 'Facebook profile link masked');
  perform pg_temp.check(r ->> 'description' like '%https://redacted.invalid/media/embedded.jpg%', 'media link inside text masked');
  perform pg_temp.check(r ->> 'description' like '%BH16 [redacted]%', 'full postcode keeps only the outward code');
  perform pg_temp.check(r ->> 'description' like '%E1 (Whitechapel) fine%', 'district-only location untouched');
  perform pg_temp.check(r ->> 'description' like '%USB 2.0 PORTS @ BACK PANEL%', 'a lone @ in text untouched');

  perform pg_temp.check((select count(*) from apify_gateway.redaction_leaks(job)) = 0, 'leak check finds nothing after redaction');
  update apify_gateway.items set item = item || '{"note": "ask for Jo Bloggs"}' where job_id = job;
  perform pg_temp.check((select count(*) from apify_gateway.redaction_leaks(job)) > 0, 'leak check catches a planted seller name');
end;
$$;

-- 6. Guardrails: only the private actor, and nothing reachable by the API roles.
do $$
begin
  begin
    update apify_gateway.settings set actor_id = 'JR2fdK8Nj6OLCwKkP';
    raise exception 'NOT REJECTED: other actor';
  exception when check_violation then
    null;
  end;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform 1 from apify_gateway.jobs;
    raise exception 'NOT DENIED: anon reads jobs';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform apify_gateway.invoke();
    raise exception 'NOT DENIED: anon invokes the gateway';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform * from apify_gateway.redacted_items(1);
    raise exception 'NOT DENIED: authenticated reads redacted items';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

rollback;
\echo 'apify_gateway tests passed'
