# Facebook actor brief: sources and rules

Supplied by the owner on 2026-09-24 with the build pack. Where the build pack conflicts with these
sources, these sources win (see "Precedence" in `docs/decisions.md`). The repository is private;
read it through the session's GitHub access, never by fetching Facebook.

Repository: https://github.com/sebtimize/fb-scrap-engine (private, branch main)

**Scope** (owner, 2026-09-24): only the files in this list are read from the actor repository. It is a
separate project and the rest of it is not scanned. What these files teach informs the whole app, not
only calling the actor. See `docs/decisions.md`, "The actor is a tool".

## Start here

0. `docs/fb-actor-reference.md` in this repository: a checked reference compiled from a full read of the
   actor repository at `f177a44` (inputs, routes, output fields, costs, failure modes, app duties).
   **Rebuilt from the listed files only** (owner, 2026-09-24). `docs/fb-actor-scope-report.md` records
   what the old version held that the listed files do not support.

1. `docs/APP_INTEGRATION_GUIDE.md` (exists since 2026-09-24, 178 KB, folded by coordinator 5; the coordinator re-checks it at each sweep. Nabvy writes its own
   integration plan either way: `docs/decisions.md`, "The actor is a tool")
   https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/APP_INTEGRATION_GUIDE.md
2. `docs/HANDOFF.md`: read only the sections "Rules" and "The app: what we want it to do, and
   what the data allows"
   https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/HANDOFF.md

## Feature designs

3. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/PARTS_INTELLIGENCE.md
4. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/CONTAINER_LISTINGS.md
5. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/SELLER_DATA.md
6. `docs/design/COPY_ADVERT_SPAM.md` (exists since 2026-09-24, 26 KB, found at the 19:40 sweep, commit `1c9fd3b`; the `copy-advert` session reads it. Nabvy writes its own
   copy-advert spam design either way: `docs/decisions.md`, "The actor is a tool")
   https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/COPY_ADVERT_SPAM.md

## Data and code to copy into the app

7. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/data/city-pages.seed.json
8. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/data/part-patterns.json
9. https://github.com/sebtimize/fb-scrap-engine/blob/main/app/route-health.js
   https://github.com/sebtimize/fb-scrap-engine/blob/main/test/route-health.test.js
10. https://github.com/sebtimize/fb-scrap-engine/blob/main/.actor/input_schema.json

## Optional reference

- https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/SCALE_PLAN.md
- https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/MONETISATION_INPUTS.md
- https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/EVIDENCE_LEDGER.md
- https://github.com/sebtimize/fb-scrap-engine/blob/main/README.md

## Rules for the app agent

- Supabase project: fbapfy (ref rlgufxmsrkhyeiabdeic, eu-west-1). Leave the old
  `marketplace_monitor` schema alone.
- Call only the private Apify Actor `YfdUav3sZ2BgEf8rh`. Never touch `JR2fdK8Nj6OLCwKkP` or the public Store edition `UO1yEB9ct9SH6nHZ0`.
- Never contact Facebook directly; all Facebook traffic goes through Apify runs.
- The Apify token is a Supabase Edge Function secret; never put it in code or chat.
- Seller identity (names, IDs, pictures) is internal only. Labels read "Suspected ...:" followed
  by the facts behind them.

## Checks

- **2026-09-24 23:50 UTC (coordinator 9, GitHub API only).** Latest commit `edf7ba2` (20:58). Six commits since `d7be0a4`: `a84bc50`, `ab61374`, `802a3a1`, `fc5176f` (location lookup diagnostics, since removed), `72351f0` ("A city name is a search location: slugs bind like numeric IDs; drop the lookup fetch": `src/gateway-input.js` accepts `cityId` as `^\d{5,30}$` or a lowercase slug `^[a-z0-9]{2,60}$` that is not a reserved segment; `src/source-binding.js` binds the slug from Facebook's own request; the fetch-based resolver is deleted) and `edf7ba2` (`docs/EVIDENCE_LEDGER.md`, build 1.0.12: "A slug is now a search location bound exactly like a numeric ID"; the validation ran on the public Store edition, which Nabvy never calls). **`docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` now exist** (backlog 0.18). Numeric IDs as text are unchanged, so `city-pages` needs nothing; `location` gets backlog 1.1h (numbered 1.1b at first; renumbered on 2026-09-25 because 1.1b is the apify-gateway task).
- **2026-09-25 12:05 UTC (coordinator 10, GitHub API only).** No commits since `edf7ba2`. Blob check: `docs/APP_INTEGRATION_GUIDE.md` is now blob `c85854e` (179,013 bytes), no longer the blob `abac9a8` that coordinator 5 condensed into `docs/design/actor-app-guide.md` at `f60257b`: four later commits changed it, `1c9fd3b` (17:28, currency from Facebook's own label; the country fallback is app-side and flagged), `23da75a` (20:05, T2 results and scheduler cadence), `7640fd8` (20:19, private Actor build 1.0.83 only, app pins it) and `f323632` (20:24, approved cadence: newest-first hourly, full sweep daily, no catch-up job). `docs/design/COPY_ADVERT_SPAM.md` is unchanged since `f60257b` (blob `1c9b936`). Backlog 0.18 maps the four commits to Nabvy.
