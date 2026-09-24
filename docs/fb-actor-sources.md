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
   **Being rebuilt from the listed files only** (owner, 2026-09-24). Until the rebuilt version lands,
   do not rely on anything in it that the files below do not support.

1. `docs/APP_INTEGRATION_GUIDE.md` (not written yet; checked for until it lands. Nabvy writes its own
   integration plan either way: `docs/decisions.md`, "The actor is a tool")
   https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/APP_INTEGRATION_GUIDE.md
2. `docs/HANDOFF.md`: read only the sections "Rules" and "The app: what we want it to do, and
   what the data allows"
   https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/HANDOFF.md

## Feature designs

3. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/PARTS_INTELLIGENCE.md
4. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/CONTAINER_LISTINGS.md
5. https://github.com/sebtimize/fb-scrap-engine/blob/main/docs/design/SELLER_DATA.md
6. `docs/design/COPY_ADVERT_SPAM.md` (not written yet; checked for until it lands. Nabvy writes its own
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
- Call only the private Apify Actor `YfdUav3sZ2BgEf8rh`. Never touch `JR2fdK8Nj6OLCwKkP`.
- Never contact Facebook directly; all Facebook traffic goes through Apify runs.
- The Apify token is a Supabase Edge Function secret; never put it in code or chat.
- Seller identity (names, IDs, pictures) is internal only. Labels read "Suspected ...:" followed
  by the facts behind them.
