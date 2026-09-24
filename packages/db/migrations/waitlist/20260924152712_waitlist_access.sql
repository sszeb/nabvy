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
grant select, insert on waitlist.entries to nabvy_app;
select nabvy_core.track_updated_at('waitlist.entries');

-- The rate-limit counter (services/waitlist/src/repo/index.ts, consumeSubmitQuota): one row per
-- hashed IP, written by the same app-role transaction as the entry it is guarding. SELECT is
-- required too: `insert ... on conflict do update` reads the existing row to decide the new count.
grant select, insert, update on waitlist.submission_attempts to nabvy_app;

-- The internal read interface (rule 5 of docs/design/modules/_rules.md): every entry, while the
-- module's switch is not off (rule 11). Granted to nabvy_pipeline until a module declares waitlist
-- as a dependency and gets its own role (packages/db/README.md, "One Postgres schema per module").
-- security_invoker checks the reader's own privileges against the base table, so nabvy_pipeline
-- needs SELECT on waitlist.entries directly, not only on the view (packages/db/README.md, "Views").
grant select on waitlist.entries to nabvy_pipeline;
create view waitlist.v_waitlist with (security_invoker = true) as
  select id, email, postcode, wanted_products, utm_source, utm_medium, utm_campaign, utm_term,
         utm_content, created_at
  from waitlist.entries
  where switches.state('waitlist') <> 'off';
revoke all on waitlist.v_waitlist from public;
grant select on waitlist.v_waitlist to nabvy_pipeline;
