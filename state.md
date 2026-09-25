# Coordinator state

Updated 22:40 UTC 2026-09-25 by coordinator sweep 22:37. Setup check 2 (21:59): repo, state write, GitHub, Supabase ok (ledger 91); session tools absent in fired runs, so session starts and messages go through the dispatcher. Sweep cron restored (`37 */2 * * *`). Last sweep: 22:37. Fingerprint: 5479d39; #102@54dee1e,#101@93bd4e7,#100@945a138,#99@703d09c,#98@bbebebb,#97@307961e,#96@420a386,#93@cc6f36d,#92@7c9ec6a,#89@a3d114b,#85@4845b8b,#83@e0ba4ad,#81@b08ee6b,#70@33077da; ledger 91.

## IDs
- Coordinator Routine: `trig_01SpUT9nZPtAH1FBGiQaCiwu` (fresh session per fire; cron `37 */2 * * *` = sweep).
- Reviewer runs: on request `trig_01FPLnjfTATPb7YQivWvA7FX` (the old relay ID), hourly `trig_011fjd2grZBEWR3FqfDzTWJR` (the old watchdog ID).
- Dispatcher: `session_01LDvAXYfdUJv4TS7aT1ph7r` (Haiku, depth 7), woken by `trig_01FfBryD1G7vjpEVYpRxdSML` (`52 * * * *`).
- Old coordinator inboxes (1, 11 to 17) and reviewer 14's inbox deleted 22:30; build sessions firing them get a harmless error.
- Poke Routines: L1 web `trig_01KmJ4pPZXoRKmXRTUhtMgMF`, L2 wiring `trig_01VD8NBTFhNtAp2SnxZTVuqw`.
- Supabase project `rlgufxmsrkhyeiabdeic`. Trigger.dev project `proj_aazrktvhdfmimvxwxsnq` (secret key on the owner's PC only).

## Ledger
91 rows = plan 91 (checked 22:37). Nothing pending.

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
- In claude.ai/code/routines, for "Nabvy reviewer (on request)" and "Nabvy reviewer (hourly)": attach the repository sszeb/nabvy and set the model to Sonnet 5 (as done for the coordinator at 21:57). Until then reviewer runs may fail.
- Approve L2's pending permission prompt (session "Nabvy L2: pipeline wiring and local runner").
- `ROUTER_API_KEY` secret for router-gateway (owed since 16:45).
- #81, #83, #85, #89 have had no review for over eight hours; the hourly reviewer likely cannot run until its Routine has the repository attached (item above).
- Optional: detach unused connectors from the Nabvy environment (smaller context for every session).

## Merged, migrations pending

## Sessions to start

## Messages to send

## Docs to record (the sweep writes these into docs/progress.md)
- 22:52 UTC dispatcher run: nothing queued

## Retired
- Coordinator 16 `session_01VTx2FS552iCMDrFaiH9ods`, coordinator 17 `session_01DRRHh7vDk4PTJnPngeyXZ4`: sessions stay idle; do not wake them.
