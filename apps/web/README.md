# apps/web

The Next.js 16 PWA (nabvy.app) and the marketing pages (nabvy.com), in one app. Task 4.1a built
the design system, the app shell and every screen against typed fixtures. Auth (4.0), the oRPC
router (4.1) and the waitlist storage (0.5a) come later and do not change the screens.

## Structure

```
src/
  app/
    (marketing)/     nabvy.com layout: landing, waitlist, pricing (skeleton), sign-in
    app/(shell)/     signed-in app: dashboard, deals, deal/[id], hunts, alerts, account, scan (skeleton)
    app/onboarding/  focused layout: postcode, default hunt, channel, preview
    admin/           admin shell and review console
    design/          every component in each state (the design reference)
    globals.css      design tokens (light and dark) and the Tailwind theme
    manifest.ts      PWA manifest; icons in public/icons (placeholder wordmark)
  components/        Nabvy components (ListingCard, DealCard, PricePosition, SuspectedLabel, …)
  components/ui/     shadcn-style primitives on Radix (button, dialog, popover, tabs, …)
  data/              data-access layer: types.ts, fixtures/, index.ts
  lib/               pure logic: formatting, freshness stamp, price position, labels, nav, flags
test/                Vitest: token contrast, price position, formatting, data rules, copy rules
e2e/                 Playwright: every key screen in 4 projects, keyboard and mobile checks
```

## Data access, and how procedures replace the fixtures

Screens import only from `@/data`. Every function there is `async` and returns a screen-facing
type from `src/data/types.ts`; today the body returns fixtures. Task 4.1 replaces each body with a
call to the matching oRPC procedure (server components call the router directly; client reads go
through TanStack Query), keeping the name and signature, so no screen changes. At the same time
the types in `types.ts` become `z.infer` of the procedure output schemas in `@nabvy/contracts`.
Forms (waitlist, sign-in, hunts, preferences, report a mistake, mark as bought) are UI only and
each names the task that wires it.

`test/fixtures.test.ts` checks what the data layer returns: no seller fields at any depth, nothing
finer than a town or postcode district, no listing free text, price history only within one
listing ID, asks compared only in their own currency, labels worded as suspicions with evidence,
no scores, Facebook as the only source. The same test runs on procedure output once they exist;
this is the start of the CI check on user-facing output that `docs/decisions.md` asks for.

## Decisions taken here

- **Look.** Neutral greys and one accent (deep teal `#0f766e`, `#2dd4bf` in dark), system fonts,
  rounded inputs, a calm centred search on the home screen; a sidebar with icon sections, a top
  bar with search and a command palette (Ctrl+K or Cmd+K), tables with status chips; listing
  cards with the price first, then key facts, town and time.
- **Tokens are hex** in `globals.css` so `test/tokens.test.ts` can check WCAG AA contrast for every
  text pair (4.5:1) and boundary (3:1) in both themes. `!important` is allowed only in that file,
  for the reduced-motion override.
- **No scores anywhere.** A deal is a listing that matched a hunt; the card shows the ask, its
  position among comparable asks, labels, neutral warning signs and the freshness stamp.
- **Asking-price position** is shown from 10 comparable asks (`lib/price-position.ts`), otherwise
  "Not enough comparable asks". It speaks only of asks; EUR asks are compared only with EUR asks.
- **Suspected labels** read "Suspected …:" then the facts, with an evidence popover and "Report a
  mistake". Only listing-level kinds exist (trade seller, copied advert); scam labels stay in
  shadow mode and have no UI.
- **Listing photos** sit behind `flags.listingPhotos` (`lib/flags.ts`), off, with a neutral
  placeholder, until the owner decides on Facebook photo URLs (`docs/questions.md`).
- **Listing free text is not shown**: it can carry names and phone numbers. Screens show extracted
  facts ("Not stated, ask the seller" when silent) and short quoted evidence.
- **Locations** are a town plus a whole-kilometre distance. No map with pins.
- **Pricing and scan** are skeletons: no prices, no tier text, no scan flow until the owner
  decides (`docs/questions.md`).
- **`sharp` is removed** from the tree (`pnpm-workspace.yaml` override): it is Next's optional
  image optimiser and brings LGPL binaries; the app serves no optimised images.

## Not deployable yet

This is design scaffolding. The waitlist, sign-in, "Report a mistake", "Mark as bought", hunt and
preference forms report success without doing anything; `/app` and `/admin` have no auth guard;
there are no CSP or HSTS headers. Do not deploy the app before tasks 0.5a (waitlist storage), 4.0
(auth and the admin role) and 4.3b (security headers and rate limits) land. Fixture listing links
point at `.invalid` hosts so none can resolve to a real listing.

## Error pages (task 4.1c)

Every error the app can show uses one layout, `components/error-page.tsx`, with its copy in
`lib/errors.ts`. The layout follows the pattern big tech uses for error pages, adapted to Nabvy:
- the status code as a graphic: a teal price tag swinging on a string, in front of dashed
  search-radius rings (the swing stops when reduced motion is on);
- a short human headline in the deal-hunting register ("This one got away" for 404);
- one or two sentences on what happened and what to do next;
- one main action, an optional second one, and a few helpful links;
- "Error 404" in small print, and a reference (Next's error digest) on server errors.

| Route | When |
| --- | --- |
| `app/not-found.tsx` | 404: unknown address or `notFound()` |
| `app/error.tsx` | 500 inside the app, with "Try again" (resets the boundary) |
| `app/global-error.tsx` | 500 in the root layout; brings its own `<html>` |
| `app/unauthorized.tsx` | 401 from `unauthorized()`, e.g. when `requireUser` fails |
| `app/forbidden.tsx` | 403 from `forbidden()`, e.g. when `requireAdmin` fails |
| `app/errors/restricted` | the account-restricted notice (below) |
| `app/errors/[code]` | static pages for 400, 401, 403, 404, 408, 410, 429, 500, 502, 503 and 504. The proxy, route handlers and the CDN rewrite to these when Next's own boundaries do not apply (a 429 from the rate limiter, a 503 during maintenance) |

- `forbidden()` and `unauthorized()` need Next's `experimental.authInterrupts`, which is on in
  `next.config.ts`. It is an experimental flag for the whole app, tested on Next.js 16.3.6; check
  these two pages after any Next.js upgrade.
- Server error pages show only Next's opaque error digest as the reference, never the error's
  message or stack (`test/errors.test.ts` checks the source).
- **`/errors/restricted` stays plain on purpose:** a lock, "Account restricted", and the notice the
  owner's decision allows (`docs/decisions.md`, "Fair use, suspension and bans"): the step and the
  policy, for example "Your account has been suspended under our Fair Use Policy.", then "You can
  ask for a review within 30 days." with an "Ask for a review" action. The app redirects there
  with `?step=…&policy=…` from the auth module's refusal; anything else in the address is
  ignored, and without a valid pair the page names the Terms of Service. No illustration, joke,
  reason, date or rule. The generic 403 page never hints at a restriction. The notice is
  mirrored in `lib/errors.ts` until the auth module's contract (PR #9) can be imported.
- The copy follows the app's copy rules (no exclamation marks, no urgency, UK English).
  `test/errors.test.ts` checks it, and `e2e/errors.spec.ts` renders every page in the four
  projects and checks that an unknown address answers 404. The screenshots are
  `docs/design/screens/error-*.png`.

## Commands

```
pnpm --filter @nabvy/web dev            # http://localhost:3000
pnpm --filter @nabvy/web build
pnpm --filter @nabvy/web test           # Vitest
pnpm --filter @nabvy/web test:screens   # Playwright; needs a build first; writes docs/design/screens/
pnpm --filter @nabvy/web icons          # re-render the PNG icons from public/icons/*.svg
```

The screen tests use the preinstalled Chromium at `/opt/pw-browsers/chromium` when it exists and
never download browsers. Screenshots are records for review, not pixel baselines, because fonts
differ between machines.
