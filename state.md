# Coordinator state

Updated 08:38 UTC 2026-09-26 by coordinator (sweep 08:37: no merges, ledger 99 = plan 99, heads moved on #93/#104/#106, nothing newly READY). Setup check 2 (21:59): repo, state write, GitHub, Supabase ok; session tools absent in fired runs, so session starts and messages go through the dispatcher. Sweep cron `37 */2 * * *`. Last sweep: 08:37. Fingerprint: d1f1ffa; #110@2d2d13e,#109@ba09f25,#106@2049a03,#104@2ad368d,#102@54dee1e,#101@1a4f508,#100@6491d50,#98@bbebebb,#97@307961e,#96@420a386,#93@7ad5edf,#89@61cc5d9,#81@b08ee6b,#70@7e42044; ledger 99.

## IDs
- Coordinator Routine: `trig_01SpUT9nZPtAH1FBGiQaCiwu` (fresh session per fire; cron `37 */2 * * *` = sweep).
- Reviewer runs: on request `trig_01FPLnjfTATPb7YQivWvA7FX` (the old relay ID), hourly `trig_011fjd2grZBEWR3FqfDzTWJR` (the old watchdog ID).
- Dispatcher: `session_01LDvAXYfdUJv4TS7aT1ph7r` (Haiku, depth 7), woken by `trig_01FfBryD1G7vjpEVYpRxdSML` (`52 * * * *`).
- Old coordinator inboxes (1, 11 to 17) and reviewer 14's inbox deleted 22:30; build sessions firing them get a harmless error.
- Poke Routines: L1 web `trig_01KmJ4pPZXoRKmXRTUhtMgMF`, L2 wiring `trig_01VD8NBTFhNtAp2SnxZTVuqw`.
- Supabase project `rlgufxmsrkhyeiabdeic`. Trigger.dev project `proj_aazrktvhdfmimvxwxsnq` (secret key on the owner's PC only).

## Ledger
99 rows = plan 99 (03:10: #108 asking-price-index applied as `asking_price_index_pr108`, checksums and transcription md5 verified). Earlier: 97 rows = plan 97 (checked 00:40: #85 attribution, #99 noise-filter, #92 search-planner applied 00:39, transcriptions verified). Nothing pending.

## Open PRs (sessions; details in docs/progress.md by grep)
- #109 spec-match [cp 6] (changes-needed): dispatcher session started 01:02.
- #106 dispatch: zero-token reconciler (W2), #104 ci: faster scoped CI (W2) — `session_01WsDVema6i3QcYMjPNZK17M`.
- #102 router-gateway [cp 2], 2 migrations — `session_01ETdUVwpWrdfWdAPLvk8R8i` (Opus). On merge: start travel-time.
- #100 L2 pipeline wiring [cp 5] — `session_01EdCvNpwGNoqFD77bC9LGJa` (Haiku); blocked on a permission prompt the owner must approve.
- #98 check-scheduler (base #92 merged) — `session_018dmgrMJShzu2Mt83YDpxMx`.
- #97 demand-signals — `session_01Lq2CgBrjy6kZ6b7qTLWCM3`.
- #96 prepared-message [cp 5] — `session_011twSaUcxY8Ga8dmJHH3nHx`.
- #93 seller-reply-reports — `session_01U3VJw1mfZ6n1syQaHj7v3K`.
- #89 pickup-routes [cp 1], #81 listing-card [cp 5]: sessions in docs/progress.md.
- #70 price-drop-watch [cp 6] (changes-needed, review 5324943052: cross-pass relist under-announce + CI timeout) — round-1 session `session_013TTwsCCZGwSmh4kpgXT2pr` could not fire the fixer; round-2 fix session queued.
- #110 ci: raise the 15-minute job timeouts to 25 (coordinator, branch claude/funny-ptolemy-rdpsq9): every main CI run since #83 is cancelled at 15 min; unblocks all PRs incl. #70. Merge first; #104 supersedes it later.
- #101 coordinator docs (rolling, `claude/coordinator-16` into main; carries the old stack #84, #86, #91, #95, #103).

## Sessions without a PR
- W2b `session_0184s4vadhBCiHcAW7ZNZRRW` (Sonnet, 08:21, owner-approved): finishes #104 (CI speed, Routine hooks, folds #110's timeouts) and #106 (reconciler, vars for Routine IDs, Builder fire path). Replaces W2 `session_01WsDVema6i3QcYMjPNZK17M` (context full; do not wake). W3 waits for the owner's confirmation in its own session.
- W3 docs slimming `session_01B5g9DjscTSFaP122ZnWuDn` (Sonnet): started 00:06 by coordinator 18 (W2 now has #104 and #106; owner 2026-09-26: implement all improvements now, no pilots; docs/routines/implementation-brief.md). W1 Routines implementer: the owner starts it from the app (it changes Routine prompts).
- L3 owner setup `session_013w6mgdrer6N4BGjUZSxMTE` (Sonnet): the owner talks to it directly (WSL Ubuntu, `scripts/wsl-bootstrap.sh`, `docs/local-run.md`).
- pasted-link-lookup, inventory: stacked on #81; open their PRs after #81 merges.

## Next starts
- listing-search when #81 merges (stack on listing-card).
- travel-time when #102 merges (`claude-haiku-4-5-20251001`, branch `task/w2-travel-time`).
- L3 runbook and L4 local acceptance after L1 and L2 merge.
- photo-review stays parked (owner).

## Waiting on the owner
- (08:20) Regenerate the reviewer on-request API token (the 01:09 one was pasted in chat) and update the GitHub secret REVIEW_FIRE_TOKEN; confirm W3 in its session ("Nabvy W3: docs slimming").
- Start coordinator 19 from the app (Opus 5.5, medium effort, repo sszeb/nabvy at claude/coordinator-16, tags nabvy, nabvy-coordinator); coordinator 18 passed 150k at 23:32. First prompt: "You are Nabvy coordinator 19, the owner's control session (same brief as coordinator 18: answer the owner, check the fleet when asked, unblock stuck sessions, do session-tool work Routines cannot). Read CLAUDE.md, state.md on claude/coordinator-state , docs/routines/improvement-plan.md and docs/routines/daisy-chain.md (owner asked 23:40 for daisy-chained Routines; decide the k-way split only after the two-module pilot); everything else by grep or sed -n slices. Coordinator 18 at 23:30 put the reviewer rules inline in both reviewer Routine prompts, fired on-request reviews for #83, #85 and #89 (#81 was refused by the permission classifier), and wrote the improvement plan. Next: once the owner has done the plan's owner actions 1-3, queue the docs-and-scripts PR (plan rollout step 2) for a Sonnet docs session via state.md; then follow the rollout order. First turn: get_trigger on the coordinator and hourly reviewer Routines, report the three review runs' outcomes, then wait for the owner."
- (coordinator 18, 23:30) Plan: docs/routines/improvement-plan.md on claude/coordinator-16 (#101). Owner in the app: (1) remove the "Pull request: Converted to draft" GitHub trigger from "Nabvy reviewer (on request)", keep it API-only; (2) on the coordinator Routine add GitHub trigger "Pull request: Closed" with filters Is merged = true and Base branch = main; (3) later, per the plan's rollout: API tokens for the reviewer and Fixer as repository secrets (never in chat).
- Agents cannot fire the Fixer Routine `trig_01UhN94zqkCRYjd7fjwSgKYF` (created via http_api); fix rounds go through the dispatcher until the owner recreates it from the app.
- PR #81 review fire was refused by the permission classifier at 23:30; the hourly reviewer backstop or the owner fires it.
- In claude.ai/code/routines, for "Nabvy reviewer (on request)" and "Nabvy reviewer (hourly)": attach the repository sszeb/nabvy and set the model to Sonnet 5 (as done for the coordinator at 21:57). Until then reviewer runs may fail.
- Approve L2's pending permission prompt (session "Nabvy L2: pipeline wiring and local runner").
- `ROUTER_API_KEY` secret for router-gateway (owed since 16:45).
- #81 and #89 still unreviewed (#83, #85 merged); #96, #97, #98 unreviewed over four hours; the hourly reviewer likely cannot run until its Routine has the repository attached (item above).
- Optional: detach unused connectors from the Nabvy environment (smaller context for every session).

## Merged, migrations pending

## Sessions to start
- asking-price-position: model claude-opus-5-5; branch task/w2-asking-price-position; base main; brief briefs/asking-price-position.md
- warning-signs: model claude-opus-5-5; branch task/w2-warning-signs; base main; brief briefs/warning-signs.md
- scan-lookup: model claude-sonnet-5; branch task/w2-scan-lookup; base main; brief briefs/scan-lookup.md
- price-drop-watch-fix2: model claude-haiku-4-5-20251001; branch task/w1-price-drop-watch; base task/w1-price-drop-watch; brief briefs/price-drop-watch-fix2.md

## Messages to send
- Fire reviewer on-request `trig_01FPLnjfTATPb7YQivWvA7FX` with "PR #110: ci: raise the 15-minute job timeouts to 25" (priority: every PR's CI is cancelled until it merges).

## Docs to record (the sweep writes these into docs/progress.md)
- W3 docs slimming: PR #112 (`task/0.20c-docs-slim`, base `claude/coordinator-16`, rides on #101) opened — CLAUDE.md 11,965→3,967 B, docs/decisions.md 76,420→21,195 B (history: docs/decisions-history.md), docs/questions.md 229,162→67,931 B (archive: docs/questions-archive.md); docs/rules.md new.

## Retired
- Coordinator 16 `session_01VTx2FS552iCMDrFaiH9ods`, coordinator 17 `session_01DRRHh7vDk4PTJnPngeyXZ4`: sessions stay idle; do not wake them.
