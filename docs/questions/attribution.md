# Open questions — attribution module

Same format as `docs/questions.md` (date, task, question, option taken and why), kept in its own
file per module so parallel build sessions never conflict. The coordinator folds these into
`docs/questions.md` at a check-in.

- **2026-09-24, w1 attribution: wiring `trackSale`/`reverseSale` into a real Stripe caller.** The
  card lists "Stripe invoice, chargeback and legally required refund events" as inputs, but there
  is one Stripe webhook secret in the whole system (`docs/secrets.md`), owned by `subscriptions`,
  and a module session may only touch its own files. Option taken: `trackSale`/`reverseSale` take
  clean, already-resolved parameters (invoice ID, amount, dispute or refund event ID) rather than
  parsing a raw webhook, the same way `usage-ledger.grant()` never parses Stripe either. Who calls
  them with real data — `subscriptions`' own webhook handler once revisited, or an app-layer
  orchestrator once `apps/web`'s oRPC layer exists — is not decided; until then these functions are
  unreachable from a real payment. Conservative because it keeps this module decoupled and adds no
  Stripe SDK dependency here; the alternative (a second Stripe webhook endpoint and secret) was
  rejected as undocumented surface a module session should not invent.
- **2026-09-24, w1 attribution: the affiliate programme's two-sided customer discount.**
  `docs/affiliates.md`'s Terms table gives every referred user (creator-driven or peer-driven) a
  £5 credit, plus an optional extra discount "the creator chooses to pass on". The card's own line
  names only "referral pairs" for the £5 credit through `usage-ledger.grant()`. Option taken: this
  module's £5 give-£5-get-£5 credit fires only for a peer's own referral code
  (`referral_codes`/`referrals`); a Dub-driven, creator-attributed sign-up earns the creator a
  cash commission through Dub but grants no additional credit from this module's own code (that
  reward, if wanted, is Dub-side reward configuration). Conservative because it follows the card's
  literal scope and never double-grants; a product decision may want the Dub-driven path to credit
  too.
- **2026-09-24, w1 attribution: referral credit's credits-per-£5 conversion.** No pricing-console
  policy exists yet to convert cash to credits, the same gap `usage-ledger`'s own bundle and
  top-up grants have. Option taken: `ATTRIBUTION_REFERRAL_CREDIT_CREDITS` (500) in
  `packages/config/src/modules/attribution.ts`, from Starter's own net rate in
  `docs/design/pricing-model.md` (£12 ÷ 1,200 cr ≈ 1p/credit; £5 ≈ 500 cr), a starting value
  pending a real policy.
- **2026-09-24, w1 attribution: an unknown referral code is dropped, not refused.** The card gives
  no rule for a mistyped or stale referral code at sign-up. Option taken: `captureAttribution`
  drops it silently and still captures the rest of sign-up, rather than refusing the whole call.
  Conservative because a bad marketing parameter should never block account creation; the
  alternative (refuse the whole capture) was rejected as too strict for a one-off marketing input.
