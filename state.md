# Coordinator state

Updated 03:10 UTC 2026-09-26 by coordinator (merge #108). Setup check 2 (21:59): repo, state write, GitHub, Supabase ok; session tools absent in fired runs, so session starts and messages go through the dispatcher. Sweep cron `37 */2 * * *`. Last sweep: 02:38. Fingerprint: d1f1ffa; #109@4944a85,#106@cbb3ecc,#104@190c16c,#102@54dee1e,#101@ee78e16,#100@6491d50,#98@bbebebb,#97@307961e,#96@420a386,#93@cc6f36d,#89@61cc5d9,#81@b08ee6b,#70@7e42044; ledger 99.

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
- #70 price-drop-watch [cp 6] — fix session `session_013TTwsCCZGwSmh4kpgXT2pr`; its CI re-run check-in fires 22:09.
- #101 coordinator docs (rolling, `claude/coordinator-16` into main; carries the old stack #84, #86, #91, #95, #103).

## Sessions without a PR
- W3 docs slimming `session_01B5g9DjscTSFaP122ZnWuDn` (Sonnet): started 00:06 by coordinator 18 (W2 now has #104 and #106; owner 2026-09-26: implement all improvements now, no pilots; docs/routines/implementation-brief.md). W1 Routines implementer: the owner starts it from the app (it changes Routine prompts).
- L3 owner setup `session_013w6mgdrer6N4BGjUZSxMTE` (Sonnet): the owner talks to it directly (WSL Ubuntu, `scripts/wsl-bootstrap.sh`, `docs/local-run.md`).
- pasted-link-lookup, inventory: stacked on #81; open their PRs after #81 merges.

## Next starts
- listing-search when #81 merges (stack on listing-card).
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
- #81 and #89 still unreviewed (#83, #85 merged); #96, #97, #98 unreviewed over four hours; the hourly reviewer likely cannot run until its Routine has the repository attached (item above).
- Optional: detach unused connectors from the Nabvy environment (smaller context for every session).

## Merged, migrations pending

## Sessions to start
- asking-price-position: model claude-opus-5-5; branch task/w2-asking-price-position; base main; brief briefs/asking-price-position.md
- warning-signs: model claude-opus-5-5; branch task/w2-warning-signs; base main; brief briefs/warning-signs.md
- scan-lookup: model claude-sonnet-5; branch task/w2-scan-lookup; base main; brief briefs/scan-lookup.md

## Messages to send

## Docs to record (the sweep writes these into docs/progress.md)
- 03:10 UTC #108 asking-price-index merged (main d1f1ffa); 2 migrations applied as `asking_price_index_pr108`, ledger 99 = plan 99, md5 verified. Newly READY and queued: asking-price-position [cp 6], warning-signs [cp 6], scan-lookup [cp 1].
- 02:38 sweep: the docs-batch commit and push to claude/coordinator-16 was refused by the permission classifier, so these lines and the five docs/questions/*.md files stay for the next sweep. Also record: #108, #109 opened (progress rows for asking-price-index, spec-match); #107 merged, no migrations; ledger 97 = plan 97; no stalled PRs. The branch needs origin/main merged in (docs/session-conventions.md conflicts; take main's side).
- 01:22 UTC W1 Routines: PR #107 post-merge review posted "Approved (post-merge check)" (session `cse_01NwzMuCDQQrBvLmaBdx9LCy`, comment only, no action taken) — confirms both pre-merge blocking findings resolved, notes one non-blocking nit (the merged head's required "Typecheck, lint and test" check completed `cancelled` not `success`, low risk, no fixtures/extraction/valuation touched) and one harmless nit (PR body's stale head sha). W1 step D is gated on W2's CI PR #104 merging (implementation-brief.md rollout order: step D's owner list assumes the notify-review/notify-fix jobs and REVIEW_ROUTINE_ID/FIX_ROUTINE_ID vars from #104 exist); #104 has 2 unresolved blocking review findings since 00:11 (the docs-only-skip regex matches `.yml` — including `ci.yml` itself, so `checks`/`audit`/`migrations` skip on #104's own runs — and a duplicate `pnpm test` invocation on the PR path) and no new commits/reviews since 01:04. W1 is holding step D until #104 is fixed and merged; not touching #104 (W2's file).
- 01:14 UTC W1 Routines: step C done. Coordinator `trig_01SpUT9nZPtAH1FBGiQaCiwu` prompt now runs `node scripts/precheck.mjs coordinator` as step 1 (ends on QUIET), loads Supabase tools only on the migration-apply step, and reads docs/routines/coordinator.md by section (`sed -n '/^## Sweep/,/^## Applying/p'` / `'/^## Applying/,/^## Build-session/p'`), not `sed -n '1,400p'`. Both reviewer Routines (`trig_01FPLnjfTATPb7YQivWvA7FX` on-request, `trig_011fjd2grZBEWR3FqfDzTWJR` hourly/backstop) now point at `docs/routines/reviewer.md` instead of carrying the rules inline; the hourly one also runs `node scripts/precheck.mjs reviewer` as its backstop pick when nothing is appended. All three prompts keep a "falls back to previous brief if the file is missing" line and the owner's standing rules, plus a new one: never merge your own PR — fire the reviewer instead. Owner's rule going forward (2026-09-26 01:11): the coordinator/build path never merges its own PRs. PR #107 post-merge: `changes-needed` label removed (leftover from the pre-fix reviews on 87a4f1a), on-request reviewer fired once with "PR #107 post-merge check: review commits after 87a4f1a; comment only" (session `cse_01NwzMuCDQQrBvLmaBdx9LCy`) — comment-only, no merge expected (already merged). Next: W1 step D (one owner list: Fixer/Builder Routines, merged-PR trigger, API tokens as GitHub secrets) once W2's CI PR (#104) merges; step E after that (prove the chain on 2 PRs, then reviewer cron `34 */2`, delete stale pokes `trig_01KmJ4pPZXoRKmXRTUhtMgMF`/`trig_01VD8NBTFhNtAp2SnxZTVuqw`).
- 01:10 UTC #107 routines role files and pre-check (W1 step A) merged; no migrations; main 5641855.
- 01:02 UTC dispatcher started asking-price-index as session_01ActYkBhNtpcqMRWWSjE61p\ - 01:02 UTC dispatcher started spec-match as session_01EXXNdf8VXEm7qaHEbiBWaU

## Retired
- Coordinator 16 `session_01VTx2FS552iCMDrFaiH9ods`, coordinator 17 `session_01DRRHh7vDk4PTJnPngeyXZ4`: sessions stay idle; do not wake them.
