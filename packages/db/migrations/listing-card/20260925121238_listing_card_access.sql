-- listing-card owns no tables (design card "Owns: none"; services/listing-card/README.md): its
-- only output is the user-facing view app.v_listing_card, the first view in the shared `app`
-- schema, so this file creates that schema too. It also creates its own empty schema,
-- `listing_card`: packages/db/tests/core.test.sql requires every module in the migration ledger to
-- have the schema `replace(module, '-', '_')`, since the ledger and view checks derive a module's
-- schema name that way. Depends on switches (is_on), listing-ingest (v_listings), detail-evidence
-- (v_current), listing-lifecycle (v_status, read only to keep an unresolved listing off the card;
-- README "Decisions"), listing-suppression (is_suppressed) and quote-redaction (redact).
--
-- The row-building logic lives in a SECURITY DEFINER function, `app.listing_card()`, not directly
-- in the view. A first draft made app.v_listing_card a plain view joining straight to
-- listing_ingest.v_listings, detail_evidence.v_current and listing_lifecycle.v_status; `pnpm
-- db:dry-run` still failed with "permission denied for table listings" for nabvy_app. Those three
-- views are each security_invoker, and Postgres checks a security_invoker view's own body against
-- the true session role wherever it is nested, even underneath a plain outer view owned by a role
-- that can read everything — so the plain-view wrapper did not help, and granting nabvy_app the
-- schemas directly would have broken listing-ingest's, detail-evidence's and listing-lifecycle's
-- own packages/db/tests/*.test.sql, which each assert nabvy_app has no usage on them at all. A
-- SECURITY DEFINER function does not have that problem, because it changes the effective user for
-- its whole body (the same reason listing_suppression.is_suppressed() already reads through these
-- same three modules' security_invoker views without nabvy_app holding any grant on them). The view
-- is kept as the public name (`app.v_listing_card`, matching rule 5 and the module card) but is a
-- thin wrapper over the function.

create schema if not exists app;
create schema if not exists listing_card;

-- The public listing feed's one row per listing: exactly the columns the module card allows, and
-- nothing rule 5 forbids (no seller field, no coordinates, no copy-cluster or relist-group ID, no
-- photo column while the listing-photos switch stays off). Fresh card fields (price, availability,
-- title) come from listing-ingest, never from a possibly stale detail fetch (module card, "Fresh
-- card fields win over saved detail fields"); condition and description status exist only once a
-- detail fetch has happened, so that join is left and both read null until then.
create function app.listing_card()
returns table (
  listing_id uuid,
  link text,
  title text,
  price_minor bigint,
  currency text,
  listed_at timestamptz,
  town_label text,
  condition text,
  availability text,
  description_status text,
  possibly_outdated boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id as listing_id,
    case when l.source = 'facebook'
      then 'https://www.facebook.com/marketplace/item/' || l.source_listing_id || '/'
    end as link,
    quote_redaction.redact(l.title) as title,
    l.price_minor,
    l.currency,
    l.listed_at,
    l.town_label,
    d.condition,
    l.availability,
    d.description_status,
    coalesce(d.stale_fallback, false) as possibly_outdated
  from listing_ingest.v_listings l
  left join detail_evidence.v_current d on d.listing_id = l.id
  left join listing_lifecycle.v_status s on s.listing_id = l.id
  where switches.is_on('listing-card')
    and switches.is_on('listing-suppression')
    and not listing_suppression.is_suppressed(l.id)
    and coalesce(s.status, 'unknown') <> 'unresolved'
$$;

revoke all on function app.listing_card() from public;
grant usage on schema app to nabvy_app, nabvy_pipeline;
grant execute on function app.listing_card() to nabvy_app, nabvy_pipeline;

create view app.v_listing_card as select * from app.listing_card();
revoke all on app.v_listing_card from public, anon, authenticated;
grant select on app.v_listing_card to nabvy_app, nabvy_pipeline;
