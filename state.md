# Coordinator state

Setup check 2 at 21:59 UTC: repo ok, state write ok, GitHub ok, session tools failed, Supabase ok (ledger 91). Session tools (add_repo, get_trigger, fire_trigger, create_session, get_session) returned nothing from ToolSearch in the fired run; the sweep cron stays parked.

## IDs
- Coordinator Routine: `trig_01SpUT9nZPtAH1FBGiQaCiwu` (fresh session per fire; cron `37 */2 * * *` = sweep).
- Reviewer 14: `session_01S1zLkd1F9tHKsNc1MiwKF5`, inbox `trig_01HBnPvViK2spaRpcTnCv8du`. Its inbox prompt names coordinator 14's inbox, which forwards 14 → 15 → 16 → this Routine. At the next reviewer hand-off, name this Routine directly.
- Relay `trig_01FPLnjfTATPb7YQivWvA7FX` (step 2 → this Routine). Watchdog `trig_011fjd2grZBEWR3FqfDzTWJR` (step 4 → this Routine).
- Old coordinator inboxes forward: 11 `trig_01W4s8vjL92nj6mW89oiLs34` → 12 `trig_01NQq5pF6QXYV6omzE8LafYm` → 13 `trig_01RWmeGsimSKC8sX8N8oao8w` → 14 `trig_01PQbRJk6Rb78r4oYm2XuzHg` → 15 `trig_01Xrhk1z2Bb1iNN3DWbbPxSB` → 16 `trig_012hwP8EisfTTijBVBCAWhU5` → this Routine; 17 `trig_01EPFT3WRpVqsmDa2y8WMyHo` → this Routine.
- Poke Routines: L1 web `trig_01KmJ4pPZXoRKmXRTUhtMgMF`, L2 wiring `trig_01VD8NBTFhNtAp2SnxZTVuqw`.
- Supabase project `rlgufxmsrkhyeiabdeic`. Trigger.dev project `proj_aazrktvhdfmimvxwxsnq` (secret key on the owner's PC only).

## Ledger
91 rows = plan 91 (19:42, after #94, #90, #88). Nothing pending.

## Open PRs (sessions; details in docs/progress.md by grep)
- #102 router-gateway [cp 2], 2 migrations — `session_01ETdUVwpWrdfWdAPLvk8R8i` (Opus). On merge: start travel-time.
- #100 L2 pipeline wiring [cp 5] — `session_01EdCvNpwGNoqFD77bC9LGJa` (Haiku); blocked on a permission prompt the owner must approve.
- #99 noise-filter [cp 8] — `session_01PAUb9EWufR4DsmqKijgCpk`.
- #98 check-scheduler (stacked on #92) — `session_018dmgrMJShzu2Mt83YDpxMx`.
- #97 demand-signals — `session_01Lq2CgBrjy6kZ6b7qTLWCM3`.
- #96 prepared-message [cp 5] — `session_011twSaUcxY8Ga8dmJHH3nHx`.
- #93 seller-reply-reports — `session_01U3VJw1mfZ6n1syQaHj7v3K`.
- #92 search-planner — `session_014FfP4BL46j5zAsswC6BjjM`.
- #89 pickup-routes [cp 1], #85 attribution, #83 details-queue 1.4h [cp 4], #81 listing-card [cp 5]: sessions in docs/progress.md.
- #70 price-drop-watch [cp 6] — fix session `session_013TTwsCCZGwSmh4kpgXT2pr`; its CI re-run check-in fires 22:09.
- #101 coordinator docs (rolling, `claude/coordinator-16` into main; carries the old stack #84, #86, #91, #95, #103).

## Sessions without a PR
- L1 web local run `session_01ULyWCky4X9u2Dn35prXFPr` (Sonnet): had halted on "L1 not in backlog" (milestone L is only on the docs branch until #101 merges); told to go ahead at 21:35.
- L3 owner setup `session_013w6mgdrer6N4BGjUZSxMTE` (Sonnet): the owner talks to it directly (WSL Ubuntu, `scripts/wsl-bootstrap.sh`, `docs/local-run.md`).
- pasted-link-lookup, inventory: stacked on #81; open their PRs after #81 merges.

## Next starts
- travel-time when #102 merges (`claude-haiku-4-5-20251001`, branch `task/w2-travel-time`).
- L3 runbook and L4 local acceptance after L1 and L2 merge.
- photo-review stays parked (owner).

## Waiting on the owner
- In claude.ai/code/routines, edit "Nabvy coordinator (inbox and sweep)": attach the repository sszeb/nabvy and the Supabase connector, and set the model. A session cannot do any of these. Then fire it once to confirm a run can write state.
- Attach the Supabase connector to the coordinator Routine, and set its model to Opus 5.5, in claude.ai/code/routines (sessions cannot).
- Approve L2's pending permission prompt (session "Nabvy L2: pipeline wiring and local runner").
- `ROUTER_API_KEY` secret for router-gateway (owed since 16:45).
- Optional: detach unused connectors from the Nabvy environment (smaller context for every session).

## Docs to record (the sweep writes these into docs/progress.md)
- 21:40 stateless coordinator in place (`docs/decisions.md` "Stateless coordinator"); coordinator 17 `session_01DRRHh7vDk4PTJnPngeyXZ4` retired, its sweep deleted.
- router-gateway PR #102 opened (by 21:15).

## Retired
- Coordinator 16 `session_01VTx2FS552iCMDrFaiH9ods`, coordinator 17 `session_01DRRHh7vDk4PTJnPngeyXZ4`: sessions stay idle; do not wake them.
