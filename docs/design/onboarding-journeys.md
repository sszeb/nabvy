# Onboarding journeys — references for the production sign-up (owner, 2026-09-25)

Candidate end-user journeys the owner has asked to keep, to decide between and polish for the public release (milestone P; `docs/backlog.md`, "Milestone L" closing paragraph). None is built yet; the local run (milestone L) uses the magic link printed to the terminal. Wording shown to users is the owner's.

## A. Single "Welcome" screen (owner, 20:30 UTC)

Reference: a Langfuse-style screen. One card, headline "Welcome", subline "Create an account or login", then provider buttons (Google; GitHub and SSO in the reference, not for Nabvy's users), a divider, an email field and one "Continue with Email" button, and the line "By signing up you agree to our terms and privacy policy" with links. Sign-up and sign-in are the same screen; there is no password. Fits `docs/security.md` (Better Auth: magic link or code by email, Google) and coordinator 10's recommendation of a six-digit email code on phones (`docs/questions.md`, "Sign-up without a card, and regions", still open).

## B. "Confirm a couple of details" step after first sign-in (owner, 20:40 UTC)

Reference: Trigger.dev's first-run card. Headline "Welcome to <product>", subline "We just need you to confirm a couple of details", then: full name (required, prefilled from the provider), email (required, prefilled, read-only when it came from the provider), an optional single-choice "How did you hear about us?" chip row (LinkedIn, search engine, YouTube, Twitter/X, word of mouth, event, AI assistant, blog or article, other), an optional "What role fits you best?" select, and one "Continue" button. Value for Nabvy: a name for alerts and messages, a consented attribution answer beside the Dub click data (`docs/affiliates.md`), and a first place to ask for the home location the card distance line needs (`docs/decisions.md`, "Card location line and the map view"). Keep it to one screen and make every question but name optional; a "role" question would become "what are you hunting for" or be dropped.

## Open for the owner at milestone P

- A alone, or A followed by B.
- Email code or magic link for "Continue with Email".
- Which optional questions B asks, and their wording.
- Whether the home location is asked in B or only in account preferences.
