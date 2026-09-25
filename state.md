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
- Start coordinator 19 from the app (Opus 5.5, medium effort, repo sszeb/nabvy at claude/coordinator-16, tags nabvy, nabvy-coordinator); coordinator 18 passed 150k at 23:32. First prompt: "You are Nabvy coordinator 19, the owner's control session (same brief as coordinator 18: answer the owner, check the fleet when asked, unblock stuck sessions, do session-tool work Routines cannot). Read CLAUDE.md, state.md on claude/coordinator-state , docs/routines/improvement-plan.md and docs/routines/daisy-chain.md (owner asked 23:40 for daisy-chained Routines; decide the k-way split only after the two-module pilot); everything else by grep or sed -n slices. Coordinator 18 at 23:30 put the reviewer rules inline in both reviewer Routine prompts, fired on-request reviews for #83, #85 and #89 (#81 was refused by the permission classifier), and wrote the improvement plan. Next: once the owner has done the plan's owner actions 1-3, queue the docs-and-scripts PR (plan rollout step 2) for a Sonnet docs session via state.md; then follow the rollout order. First turn: get_trigger on the coordinator and hourly reviewer Routines, report the three review runs' outcomes, then wait for the owner."
- (coordinator 18, 23:30) Plan: docs/routines/improvement-plan.md on claude/coordinator-16 (#101). Owner in the app: (1) remove the "Pull request: Converted to draft" GitHub trigger from "Nabvy reviewer (on request)", keep it API-only; (2) on the coordinator Routine add GitHub trigger "Pull request: Closed" with filters Is merged = true and Base branch = main; (3) later, per the plan's rollout: API tokens for the reviewer and Fixer as repository secrets (never in chat).
- PR #81 review fire was refused by the permission classifier at 23:30; the hourly reviewer backstop or the owner fires it.
- In claude.ai/code/routines, for "Nabvy reviewer (on request)" and "Nabvy reviewer (hourly)": attach the repository sszeb/nabvy and set the model to Sonnet 5 (as done for the coordinator at 21:57). Until then reviewer runs may fail.
- Approve L2's pending permission prompt (session "Nabvy L2: pipeline wiring and local runner").
- `ROUTER_API_KEY` secret for router-gateway (owed since 16:45).
- #81, #83, #85, #89 have had no review for over eight hours; the hourly reviewer likely cannot run until its Routine has the repository attached (item above).
- Optional: detach unused connectors from the Nabvy environment (smaller context for every session).

## Merged, migrations pending
- PR #85 merged 23:33 UTC (00f84d453f8156af21e842fe9028dddf4d09c0cc): packages/db/migrations/attribution/20260924194703_attribution_tables.sql, packages/db/migrations/attribution/20260924194712_attribution_access.sql
- PR #99 merged 22:41 UTC (7fd5357f88baad680c39d2140a768eff4c273e54): packages/db/migrations/noise-filter/20260925194153_noise_filter_tables.sql, packages/db/migrations/noise-filter/20260925194155_noise_filter_access.sql

## Sessions to start

## Messages to send

## Docs to record (the sweep writes these into docs/progress.md)
- 23:30 UTC coordinator 18: both reviewer Routine prompts carry their rules inline (no read of docs/session-conventions.md; backstop order: base of a stack, then [cp N], then oldest); on-request reviews fired for #83, #85, #89; fleet and Routines plan in docs/routines/improvement-plan.md.
- 22:52 UTC dispatcher run: nothing queued

## Retired
- Coordinator 16 `session_01VTx2FS552iCMDrFaiH9ods`, coordinator 17 `session_01DRRHh7vDk4PTJnPngeyXZ4`: sessions stay idle; do not wake them.
