-- waitlist: grants, the updated_at trigger, the internal view and its switch filter. Hand-written.
comment on schema waitlist is
  'Waitlist: pre-launch sign-ups (email, postcode, wanted products, UTM). Owner: the waitlist module.';
revoke all on schema waitlist from public;
revoke all on waitlist.entries from public;
revoke all on waitlist.submission_attempts from public;

-- The web app writes: an oRPC procedure calls services/waitlist's submit(), which validates the
-- form input and rate limits per IP before it ever reaches these tables. No RLS: entries carry no
-- user_id (sign-ups are anonymous, docs/security.md).
grant usage on schema waitlist to nabvy_app, nabvy_pipeline;
select nabvy_core.track_updated_at('waitlist.entries');

-- No direct table privilege for nabvy_app at all, not even INSERT: Postgres requires SELECT on the
-- target table for `insert ... on conflict do nothing` too (it must read the existing row to
-- detect the conflict), so INSERT alone cannot give submit() a read-nothing-back write (PR #31
-- review). Instead nabvy_app gets EXECUTE on this SECURITY DEFINER function, which runs as the
-- table's owner and returns nothing, so a public submission can never learn whether an address it
-- names is already on the list, or read that address's stored postcode, products or UTM.
create function waitlist.join(
  in_email text,
  in_postcode text,
  in_wanted_products text[],
  in_utm_source text,
  in_utm_medium text,
  in_utm_campaign text,
  in_utm_term text,
  in_utm_content text
) returns void
language sql security definer
set search_path = pg_catalog
as $$
  insert into waitlist.entries
    (email, postcode, wanted_products, utm_source, utm_medium, utm_campaign, utm_term, utm_content)
  values
    (in_email, in_postcode, in_wanted_products, in_utm_source, in_utm_medium, in_utm_campaign,
     in_utm_term, in_utm_content)
  on conflict (email) do nothing
$$;
revoke all on function waitlist.join(text, text, text[], text, text, text, text, text) from public;
grant execute on function waitlist.join(text, text, text[], text, text, text, text, text)
  to nabvy_app;

-- The rate-limit counter (services/waitlist/src/repo/index.ts, consumeSubmitQuota): one row per
-- hashed IP, written by the same app-role transaction as the entry it is guarding. SELECT is
-- required too: `insert ... on conflict do update` reads the existing row to decide the new count.
grant select, insert, update on waitlist.submission_attempts to nabvy_app;

-- The internal read interface (rule 5 of docs/design/modules/_rules.md): every entry, while the
-- module's switch is not off (rule 11). Granted to nabvy_pipeline until a module declares waitlist
-- as a dependency and gets its own role (packages/db/README.md, "One Postgres schema per module").
-- security_invoker checks the reader's own privileges against the base table, so nabvy_pipeline
-- needs SELECT on waitlist.entries directly, not only on the view (packages/db/README.md, "Views").
-- wanted_products may later feed demand counts, but only with consent (module card); no consent
-- is captured yet, so a reader of this view must not aggregate it into a demand count today
-- (PR #31 review; docs/questions.md, "waitlist: which fields are required").
grant select on waitlist.entries to nabvy_pipeline;
create view waitlist.v_waitlist with (security_invoker = true) as
  select id, email, postcode, wanted_products, utm_source, utm_medium, utm_campaign, utm_term,
         utm_content, created_at
  from waitlist.entries
  where switches.state('waitlist') <> 'off';
revoke all on waitlist.v_waitlist from public;
grant select on waitlist.v_waitlist to nabvy_pipeline;
