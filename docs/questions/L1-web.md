# Open questions — web L1 (the owner's local run)

Same format as `docs/questions.md` (date, task, question, option taken and why), kept in its own
file per the L1 web build session so it never conflicts with a parallel session. The coordinator
folds these into `docs/questions.md` at a check-in.

- **2026-09-25, L1 web: `listing-card` (PR #81) and `prepared-message`/`price-drop-watch`
  (PR #70) had not merged.** The task text says to build against the documented view/shape and
  note it if they are not merged by the time this session ran; none had. Option taken:
  `apps/web/src/rpc/procedures/feed.ts` and `listing.ts` read `app.v_listing_card` directly by its
  documented column list (`services/listing-card/README.md`, "Outputs") rather than call
  `cardsFor()`, which does not exist as an importable package yet; `getPreparedMessage`,
  `getWatch`, `watchListing` and `unwatchListing` are stubs behind the same procedure shapes
  `build()`/`watch()`/`unwatch()` will have, returning `null`/`available: false` rather than a
  fabricated message or a watch this session cannot honestly keep. Conservative because nothing
  is invented in the modules' place; each stub is commented with what to swap in once the real
  package merges.
- **2026-09-25, L1 web: `app.v_listing_card` has no migration on this branch either.** Not just
  the module package — the view itself does not exist in the database, since listing-card's own
  migration has not merged. A bare `select` from it would throw `relation ... does not exist`
  (Postgres `42P01`) on every real request once this ships against the production database. The
  task text says not to write a migration from this task, and to say why and stop that part if
  one seems needed. Option taken: `feed.ts`'s `selectListingCards()` catches exactly that error
  code and returns an empty result, so the feed and the listing page degrade to "nothing yet"
  rather than a 500. This is not a migration — it is why one is not written here. Once
  listing-card's migration lands, this catch becomes dead code and can be removed along with the
  raw query.
- **2026-09-25, L1 web: no `spec-match` module exists.** The results feed is supposed to be "the
  listings that match a user's wants"; nothing in the merged waves computes that match
  (`spec-match` is catalogue wave 9, depending on several modules this push did merge, but is not
  itself built). Option taken: the feed shows every listing card currently visible, newest first,
  capped at 50 (CLAUDE.md, "Batches, not items"), with no per-want filtering and no "why this
  reached you" reason (`Deal.matchReason` reads the honest "New listing", never a fabricated
  match). The `DealQuery.huntId` and `.lowAsksOnly` filters were removed from the deals page for
  the same reason: neither hunt-matching nor asking-price position exists to filter on. Search
  by title text is the only filter kept. Conservative because it shows real listings with no
  invented relevance.
- **2026-09-25, L1 web: no distance or rough time.** The task text says the feed shows
  pickup-location's "area, distance and rough time as numbers only". `pickup-location` gives the
  area; neither `location`'s user-origin distance nor `travel-time`/`router-gateway` (both
  separate, unbuilt modules) gives a distance or a time from the signed-in user's own position.
  Option taken: `ListingSummary.distanceKm` is `number | null`, and every screen that showed it
  now shows nothing when it is null, rather than a straight-line guess presented as a real
  distance (CLAUDE.md, "No invented numbers"). `formatDistance()` returns `null` for a null input.
- **2026-09-25, L1 web: no `asking-price-index`, `warning-signs` or `suspected-labels`.** The
  existing `DealPage`/`DealCard` fixtures rendered an asking-price position, suspected labels and
  warning signs unconditionally; none of those three modules is built. Option taken: `Deal.position`
  is `PricePosition | null`; the "Asking-price position" card and its compact equivalent on
  `DealCard` render only when it is not null. `suspicions`/`warnings` are real empty arrays (their
  own cards already hid when empty, so no code change was needed there) — read as "not evaluated
  yet", never as "checked and found clean", since no rule ran. `priceChanges` similarly comes only
  from price-drop-watch's own single-listing history (currently always empty, from the stub
  above), never a fabricated multi-point series.
- **2026-09-25, L1 web: no bought/sold capture module.** `MarkBought` and `DealFeedback` on the
  deal page had no backing writer (a later, unbuilt module) and are not named in the L1 task text.
  Option taken: removed from `DealPage` for this task rather than left as working-looking UI that
  saves nothing; `deal-actions.tsx`'s components are untouched for whichever task wires them.
- **2026-09-25, L1 web: no writer for a spend-governor budget's limit.** The task text names
  "spend caps (services/spend-governor policy rows)" under admin. `@nabvy/spend-governor` exports
  `readBudgets`/`readAdvice` (read-only) and `recompute()` (pipeline-driven); there is no exported
  function to change a budget's `limitMicros` from an admin action. Option taken: `/admin/switches`
  shows budgets and advice read-only, with a line saying why there is no editor, rather than write
  to the module's tables directly (a module boundary this task does not cross) or invent a setter
  the module does not offer. A real admin editor needs a task on `spend-governor` itself.
- **2026-09-25, L1 web: no list function on `incidents`.** The task text names "incidents
  (services/incidents)" under admin. `@nabvy/incidents` exports `record()` (pipeline-only) and
  `retry(db, incidentId)`; there is no function to list open incidents. Option taken: the admin
  incidents card is a "retry by ID" form (an admin who has the ID from logs), not a queue table.
  A real incidents console needs a list export from `incidents` first.
- **2026-09-25, L1 web: Turnstile is required even for the local run.** `docs/decisions.md`
  ("Local single-user run first") lists the `.env.local` variables the local run needs and does
  not include `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`; `services/auth`'s captcha plugin
  refuses `/sign-in/magic-link` with no `x-captcha-response` token regardless. Option taken: kept
  Turnstile required (never weakened the captcha check to make the local run easier), and the
  sign-in page shows a plain message instead of the widget when the keys are absent
  (`safeLoadEnv`, never a crash). The owner needs to add both keys to `.env.local` for sign-in to
  work locally; Cloudflare publishes fixed "always passes" test keys
  (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) for exactly this kind of
  local, non-production use, if real keys are not wanted yet. `docs/local-run.md` (task L3) should
  list whichever the owner chooses.
- **2026-09-25, L1 web: the local run's magic-link sender.** The task text says the link is
  printed to the server terminal when no email provider is configured, but `@nabvy/auth`'s own
  `createAuthFromEnv()` always sends through Resend and requires `RESEND_API_KEY`. Option taken:
  `apps/web/src/app/api/auth/[...all]/route.ts` builds its own `Auth` instance with `createAuth()`
  (exported by `@nabvy/auth` for exactly this), passing a terminal-printing sender when
  `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` are unset and `createResendMagicLinkSender` otherwise —
  entirely inside apps/web's own file, never inside `services/auth` (a module session edits only
  its own folder).
- **2026-09-25, L1 web: a want has no name, category or stored postcode.** `HuntForm`'s existing
  fields (name, category, postcode district) do not exist on `WantManagerWant`/
  `WantManagerUpsertWantInput`; the postcode is deliberately never stored
  (`services/want-manager/README.md`). Option taken: dropped the name and category inputs (a
  want's display name is derived from its criteria); the postcode input stays but is asked for
  again on every save, including edits, since there is nothing to prefill; `HuntCard`'s location
  line shows the resolved `centreId` instead of a postcode district. Whether a want should carry
  its own display name, and whether prefilling the postcode on edit is worth storing something
  for, are product decisions, not this session's to make.
- **2026-09-25, L1 web: per-hunt alert channels don't exist; alert preferences are account-wide.**
  `HuntForm`'s "Send alerts to" checkboxes had no matching field on a want (`want-manager`'s
  channels live on `preferences`, one row per user, not per want). Option taken: removed the
  per-hunt checkboxes, added a note linking to Preferences, and added a new "Alerts" section on
  the Preferences page wired to `want-manager`'s real `getPreferences`/`setPreferences` (channels,
  hide-noise, hide-spam, hide-multi-quantity). The marketing preferences section on that page
  (`marketing-consent`'s digest day and list) is untouched, out of this task's scope.
- **2026-09-25, L1 web: `Account.postcodeDistrict` has no backing field.** `@nabvy/account`'s
  profile stores `displayName`, `analyticsConsent` and `designPartner` only — no location.
  Option taken: renamed to `homeArea: string | null` and the account page hides that row when
  null, rather than show a postcode this module never asked for or stored.
- **2026-09-25, L1 web: `deliverySpeed`, `alternatives`, `pcContainment`, `instantAlternatives`
  and `instantTopPicks` have no UI control yet.** `HuntForm` collects a subset of a want's fields;
  these five have no screen designed for them. Option taken: fixed, conservative defaults on every
  save (`batched_15`, `off`, `false`, `null`, `false`, `false`) until a screen exists for them.
- **2026-09-25, L1 web: the pre-existing screenshot suite (`e2e/screens.spec.ts`,
  `interaction.spec.ts`) is now silently testing the sign-in redirect, not the screen.** Those
  specs navigate to `/app`, `/app/deals`, `/app/deal/d-1002`, `/app/hunts`, `/app/hunts/h-1`,
  `/app/account` and `/app/account/preferences` with no session; task L1 added a real signed-in
  gate to those pages (`lib/session.ts`), so an unauthenticated run now redirects to `/sign-in`
  before the intended screen renders. The tests still pass (a 200 response, a visible `<h1>`, and
  the copy rules hold trivially on the sign-in page's own text), so this is not a CI failure, but
  the named screens' screenshots and copy checks are not actually exercised any more. Fixing this
  needs those specs to sign in for real (this task's own `e2e/l1.spec.ts` shows one way to), which
  is a larger, separate change to test infrastructure the L1 task did not ask for. Flagged here
  rather than silently left for someone to notice later.
- **2026-09-25, L1 web: `e2e/l1.spec.ts` needs a migrated Postgres to run for real.** Written and
  confirmed to load and plan correctly (`playwright test --project=desktop-light` lists all five
  tests), following `e2e/admin-gate.spec.ts`'s own convention of skipping its signed-in cases with
  no `DATABASE_URL`/`DATABASE_URL_PIPELINE` pointing at a migrated database. This sandbox has
  neither a Postgres server nor Docker, so the signed-in cases could not be run end to end here;
  CI's migration dry-run job (the same one `admin-gate.spec.ts` already depends on) is where they
  run for real.
