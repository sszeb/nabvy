-- marketing-consent: grants, RLS and the internal view. Hand-written (packages/db/README.md).
comment on schema marketing_consent is
  'Marketing consent, preferences and email suppressions. Owner: the marketing-consent module.';
grant usage on schema marketing_consent to nabvy_app, nabvy_pipeline;

-- marketing_consents: no updated_at column (the table's own `at` column, set on every write by
-- services/marketing-consent's own code, plays that role), so no nabvy_core.track_updated_at()
-- trigger here, unlike account.user_profiles. the user writes their own preference-centre choices and pauses through
-- withUser (a future oRPC procedure calling setPreference()/pauseAll()/resumeAll()); the pipeline
-- reads every row for v_consents and deletes a user's rows on account.deleted (rule 12 of
-- docs/design/modules/_rules.md, onAccountDeleted in services/marketing-consent/src/handlers).
grant select, insert, update, delete on marketing_consent.marketing_consents to nabvy_app;
select nabvy_core.enable_user_rls('marketing_consent.marketing_consents');
select nabvy_core.allow_pipeline('marketing_consent.marketing_consents', 'select');
select nabvy_core.allow_pipeline('marketing_consent.marketing_consents', 'delete');
grant select, delete on marketing_consent.marketing_consents to nabvy_pipeline;

-- email_suppressions and newsletter_subscribers carry no user_id (an address may belong to a
-- non-user, e.g. a public daily-brief subscriber): no RLS, same reasoning as waitlist.entries
-- (docs/security.md). Both are written only from a pipeline context with no user session
-- (recordSuppression() from the Resend/PostHog webhook handler; subscribeNewsletter() and
-- unsubscribeNewsletter() from the public form and unsubscribe-link handlers once apps/web builds
-- them, the same "no user session" pattern account's Telegram bot callback uses for
-- confirmTelegramLink): no nabvy_app grant on either table yet (services/marketing-consent/README.md,
-- "Decisions").
grant select, insert, update on marketing_consent.email_suppressions to nabvy_pipeline;
grant select, insert, update on marketing_consent.newsletter_subscribers to nabvy_pipeline;

-- The internal read interface (rule 5 of docs/design/modules/_rules.md): every consent and pause
-- row, while the module's switch is not off (rule 11). Granted to nabvy_pipeline until a module
-- declares marketing-consent as a dependency and gets its own role (packages/db/README.md, "One
-- Postgres schema per module"). security_invoker checks the reader's own privileges against the
-- base table, so nabvy_pipeline needs SELECT on marketing_consents directly, not only the view.
create view marketing_consent.v_consents with (security_invoker = true) as
  select user_id, category, granted, until, source, at
  from marketing_consent.marketing_consents
  where switches.state('marketing-consent') <> 'off';
revoke all on marketing_consent.v_consents from public;
grant select on marketing_consent.v_consents to nabvy_pipeline;
