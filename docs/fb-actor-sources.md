# Facebook actor brief: sources and rules

Supplied by the owner on 2026-09-24 with the build pack. Where the build pack conflicts with these
sources, these sources win (see "Precedence" in `docs/decisions.md`). The repository is private;
read it through the session's GitHub access, never by fetching Facebook.

Repository: https://github.com/sebtimize/fb-scrap-engine (private, branch main)

## Start here

0. `docs/fb-actor-reference.md` in this repository: a checked reference compiled from a full read of the
   actor repository at `f177a44` (inputs, routes, output fields, costs, failure modes, app duties).

1. `docs/APP_INTEGRATION_GUIDE.md` (being written; check back until it exists)
   https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/APP_INTEGRATION_GUIDE.md
2. `docs/HANDOFF.md`: read only the sections "Rules" and "The app: what we want it to do, and
   what the data allows"
   https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/HANDOFF.md

## Feature designs

3. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/PARTS_INTELLIGENCE.md
4. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/CONTAINER_LISTINGS.md
5. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/SELLER_DATA.md
6. `docs/design/COPY_ADVERT_SPAM.md` (being written; check back until it exists)
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
- Call only the private Apify Actor `YfdUav3sZ2BgEf8rh`. Never touch `JR2fdK8Nj6OLCwKkP`.
- Never contact Facebook directly; all Facebook traffic goes through Apify runs.
- The Apify token is a Supabase Edge Function secret; never put it in code or chat.
- Seller identity (names, IDs, pictures) is internal only. Labels read "Suspected ...:" followed
  by the facts behind them.
