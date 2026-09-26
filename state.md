# Coordinator state

Updated 13:30 UTC 2026-09-26 by coordinator (merge event: #111 asking-price-position merged as 8ab3149, 2 migrations applied as `asking_price_position_pr111`, md5 verified; ledger 107, plan 109: #93 seller-reply-reports merged as bda52c5 but not yet applied). Before that: 13:20 UTC 2026-09-26 by coordinator (merge event: #109 spec-match merged as eb55376, 2 migrations applied as `spec_match_pr109`, md5 verified; ledger 105 incl. #102's router-gateway). Before that: 13:10 by coordinator 20 (owner steps done, #115 merged, handoff to coordinator 21). Before that: 13:08 UTC 2026-09-26 by coordinator (merge event: #115 reviewer memory merged by the owner as 0366edc, no migrations). Earlier: 12:55 by coordinator 20 (control session: #115, #114 merged, PR unsticking; see "Workflow check"). Before that: 12:40 by coordinator (merge event: #114 warning-signs merged as bfd3813, 2 migrations applied as `warning_signs_pr114`, ledger 101 = plan 101, md5 verified). Earlier: (sweep 12:37: no merges, ledger 99 = plan 99; #114 warning-signs opened; docs batch 4fd62ac). Earlier: merge event 10:50 (#101 as 2fbe3b8). Setup check 2 (21:59): repo, state write, GitHub, Supabase ok; session tools absent in fired runs, so session starts and messages go through the dispatcher. Sweep cron `37 */2 * * *`. Last sweep: 12:37. Fingerprint: 0366edc; #113@f0f27cf,#112@0e837a1,#111@1881b8c,#110@2d2d13e,#106@367a86d,#104@027acc2,#102@54dee1e,#100@6491d50,#98@bbebebb,#97@307961e,#96@420a386,#93@7ad5edf,#89@61cc5d9,#81@b08ee6b,#70@f7f3e11; ledger 103.

## IDs
- Coordinator Routine: `trig_01SpUT9nZPtAH1FBGiQaCiwu` (fresh session per fire; cron `37 */2 * * *` = sweep).
- Reviewer runs: on request `trig_01FPLnjfTATPb7YQivWvA7FX` (the old relay ID), hourly `trig_011fjd2grZBEWR3FqfDzTWJR` (the old watchdog ID).
- Dispatcher: `session_01LDvAXYfdUJv4TS7aT1ph7r` (Haiku, depth 7), woken by `trig_01FfBryD1G7vjpEVYpRxdSML` (`52 * * * *`).
- Old coordinator inboxes (1, 11 to 17) and reviewer 14's inbox deleted 22:30; build sessions firing them get a harmless error.
- Poke Routines: L1 web `trig_01KmJ4pPZXoRKmXRTUhtMgMF`, L2 wiring `trig_01VD8NBTFhNtAp2SnxZTVuqw`.
- Supabase project `rlgufxmsrkhyeiabdeic`. Trigger.dev project `proj_aazrktvhdfmimvxwxsnq` (secret key on the owner's PC only).

## Ledger
103 rows, plan 105 (13:25: #102 router-gateway applied as `router_gateway_pr102`, checksums and transcription md5 verified; spec-match's 2 from #109 pending). Earlier: 105 rows (13:20: #109 spec-match applied as `spec_match_pr109`, checksums and transcription md5 verified; the other 2 new rows are #102 router-gateway, applied by its own merge run). Earlier: 101 rows = plan 101 (13:10: #114 warning-signs applied as `warning_signs_pr114`, checksums and transcription md5 verified). Earlier: 99 rows = plan 99 (03:10: #108 asking-price-index applied as `asking_price_index_pr108`, checksums and transcription md5 verified). Earlier: 97 rows = plan 97 (checked 00:40: #85 attribution, #99 noise-filter, #92 search-planner applied 00:39, transcriptions verified). Nothing pending.

## Open PRs (sessions; details in docs/progress.md by grep)
- #116 scan-lookup (fix-r1): `session_01NrX4WGkyZ76JoBoK6inbsY` (Sonnet, 390k).
- #112 W3 docs slimming: base now main, main merged 12:41; W3 session archived 13:00 (owner) — reviewer and Fixer drive it (still labelled changes-needed from 09:04).
- #106 dispatch: zero-token reconciler (W2), #104 ci: faster scoped CI (W2) — `session_01WsDVema6i3QcYMjPNZK17M`.
- #100 L2 pipeline wiring [cp 5] — `session_01EdCvNpwGNoqFD77bC9LGJa` (Haiku); blocked on a permission prompt the owner must approve.
- #98 check-scheduler (base #92 merged) — `session_018dmgrMJShzu2Mt83YDpxMx`.
- #97 demand-signals — `session_01Lq2CgBrjy6kZ6b7qTLWCM3`.
- #96 prepared-message [cp 5] — `session_011twSaUcxY8Ga8dmJHH3nHx`.
- #93 seller-reply-reports — `session_01U3VJw1mfZ6n1syQaHj7v3K`.
- #89 pickup-routes [cp 1], #81 listing-card [cp 5]: sessions in docs/progress.md.
- #70 price-drop-watch [cp 6] (changes-needed, review 5324943052: cross-pass relist under-announce + CI timeout) — round-1 session `session_013TTwsCCZGwSmh4kpgXT2pr` could not fire the fixer; round-2 fix session `session_01Sw7J2MCK4DVGz2Wg5Z9tdd` pushed f7f3e11 (12:35).

## Sessions without a PR
- W2b `session_0184s4vadhBCiHcAW7ZNZRRW` (Sonnet, 08:21, owner-approved): finishes #104 (CI speed, Routine hooks, folds #110's timeouts) and #106 (reconciler, vars for Routine IDs, Builder fire path). Replaces W2 `session_01WsDVema6i3QcYMjPNZK17M` (context full; do not wake). W3 waits for the owner's confirmation in its own session.
- W3 docs slimming `session_01B5g9DjscTSFaP122ZnWuDn` (Sonnet): started 00:06 by coordinator 18 (W2 now has #104 and #106; owner 2026-09-26: implement all improvements now, no pilots; docs/routines/implementation-brief.md). W1 Routines implementer: the owner starts it from the app (it changes Routine prompts).
- L3 owner setup `session_013w6mgdrer6N4BGjUZSxMTE` (Sonnet): the owner talks to it directly (WSL Ubuntu, `scripts/wsl-bootstrap.sh`, `docs/local-run.md`).
- pasted-link-lookup, inventory: stacked on #81; open their PRs after #81 merges.

## Next starts
- scan-lookup [cp 1]: queued 03:10 (briefs/scan-lookup.md), no branch `task/w2-scan-lookup` or PR at 13:10; next sweep checks whether its session exists, else re-queue.
- listing-search when #81 merges (stack on listing-card).
- L3 runbook and L4 local acceptance after L1 and L2 merge.
- photo-review stays parked (owner).

## Waiting on the owner
- (13:10, coordinator 20) Owner done: reviewer (on request) GitHub triggers removed (API only); GitHub secret REVIEW_FIRE_TOKEN set; `ROUTER_API_KEY` set in Trigger.dev Development and Production. Archived at the owner's yes: warning-signs, asking-price-position, W3. Open question for the owner: archive the other idle build sessions on open PRs (they wake on every CI event): spec-match `session_01EXXNdf8VXEm7qaHEbiBWaU` (top model, 430k, #109), seller-reply-reports `session_01U3VJw1mfZ6n1syQaHj7v3K` (top, 401k, #93), pickup-routes `session_01HzP3JviAb6nM4Fz1gzedw3` (top, 343k, #89), check-scheduler `session_018dmgrMJShzu2Mt83YDpxMx` (top, 286k, #98), router-gateway `session_01ETdUVwpWrdfWdAPLvk8R8i` (top, 259k, #102), demand-signals `session_01Lq2CgBrjy6kZ6b7qTLWCM3` (top, 257k, #97), prepared-message `session_011twSaUcxY8Ga8dmJHH3nHx` (top, 207k, #96).
- Dispatcher at 152k (over its 150k stop line, 12:52); each create_session waits for owner approval. Coordinator control sessions can start sessions themselves; retire it when #106's Builder path is live.
- W2b `session_0184s4vadhBCiHcAW7ZNZRRW` idle 12:51 at 284k (over the 150k line), on #104/#106 CI; asked on #104 to run `node --test scripts/*.test.mjs`.
- Weekly usage: sessions report the seven-day limit as "allowed_warning" (11:52).
- Fixer `trig_01UhN94zqkCRYjd7fjwSgKYF`: its label and CI triggers work (#101, #113); only API firing fails. Recreating it was dropped (coordinator 20, 13:00).
- Owner WSL setup not started: when the local run is due, walk the owner through it step by step (owner 13:10: "I will do it when you say and show me"); `.env` then needs `ROUTER_API_KEY` too.
- Optional: detach unused connectors from the Nabvy environment (smaller context for every session).

## Workflow check (coordinator 19, 12:00 UTC)
Progress (coordinator 20, 13:10): fix 1 merged (#115, 0366edc; reviewer.md now claims/records in `reviewed.txt`). Fix 2 done by the owner (API only). Fix 3 done (#110 closed, #112 retargeted, #109 main merged + label cleared, main merged into #89, #93, #100, #111, #112). #114 merged. Fix 5 asked on #104. Next for coordinator 21: (a) fire the on-request reviewer once each for #109, #111, #89, #93, #112, #96, #97, #102 (runs claim the head, so no duplicates now); (b) retarget #98 to main (base task/w2-search-planner merged), merge main, then review; (c) #81: merge main and regenerate pnpm-lock.yaml (lockfile conflict), then review; (d) after the first runs, check `reviewed.txt` exists on this branch — if not, reviewer runs cannot push here (UNCLAIMED) and the memory needs another home; (e) nit from #115 review 3: coordinatorMain could use fingerprintPrs; (f) fix 4 (#100 red CI: L2 session active) and fix 6.
Works: merge -> coordinator run within seconds (#107, #108, #101; $0.40, 58k); label changes-needed -> Fixer (#101 10:39, one commit, fix-r1); hourly reviewer merges approved green heads; sweeps every 2 h.
Fix list, in order:
1. Reviewer memory. reviewer.md step 6 (`git push <sha>:refs/reviewed/pr-<n>`) gets HTTP 403: only branch pushes work, so no marker exists and runs re-review heads (#70, #93, #101, #108 three times) while green heads wait (#109 7 h, #110). Replace it with a claim line `#<n> <sha7> <verdict>` in `reviewed.txt` on this branch, pushed fast-forward BEFORE reviewing (rejected push: re-fetch; head already claimed: end). precheck reviewer reads that file. Add: a head approved while CI ran is merged by the next backstop once CI is green. One Sonnet PR (reviewer.md, precheck.mjs, test).
2. On-request reviewer API-only (owner, above).
3. Unstick PRs: #109 remove the stale changes-needed (01:46, older head) and get ba09f25 reviewed; close #110 (main has its change); retarget #112 to main (the Fixer trigger filters Base = main); #70's label predates the Fixer trigger. CI cancelled at 15 min on #89, #93, #111, #112, #70: merge main (25-min timeouts since 11:36).
4. #81 [cp 5] unreviewed since 13:00 yesterday; #100 never reviewed (red CI).
5. W2: #104 red (turbo filter), #106 red (tests); add `node --test scripts/precheck.test.mjs` to ci.yml there (CI never runs it).
6. Dispatcher needs an approval per session start; retire it once #106's Builder path is live.
Notes: #107 was merged by a session (not a reviewer run) with its test job cancelled; post-merge approval 01:15. The merge-event coordinator run wrote "Updated 10:50" at 11:37.

## Merged, migrations pending
- #93 seller-reply-reports (main bda52c5): seller-reply-reports/ both files (plan 109 vs ledger 107 at 13:30) — skip if its own merge-event run already applied them (guard raises on re-apply).

## Sessions to start
- travel-time: model claude-haiku-4-5-20251001; branch task/w2-travel-time; base main; brief briefs/travel-time.md

## Messages to send

## Docs to record (the sweep writes these into docs/progress.md)
- | Merge #111 asking-price-position | done | 2026-09-26 | 13:30 UTC: merged (main 8ab3149); 2 migrations applied as `asking_price_position_pr111`, ledger 107, md5 verified. No newly READY module. |
- | Merge #102 router-gateway | done | 2026-09-26 | 13:25 UTC: merged (main 310d36b); 2 migrations applied as `router_gateway_pr102`, ledger 103, md5 verified. travel-time newly READY, queued. |
- | Merge #109 spec-match | done | 2026-09-26 | 13:17 UTC: merged (main eb55376); 2 migrations applied as `spec_match_pr109`, md5 verified. No newly READY module from it; fold questions file spec-match.md. Idle session `session_01EXXNdf8VXEm7qaHEbiBWaU` can be archived. |
- 13:10 UTC coordinator 20: #115 merged (0366edc); owner removed the on-request reviewer's GitHub triggers, set REVIEW_FIRE_TOKEN and ROUTER_API_KEY (Trigger.dev); sessions warning-signs, asking-price-position, W3 archived; coordinator 20 handed off at 219k to coordinator 21.
- | Merge #115 reviewer memory | done | 2026-09-26 | 13:05 UTC: merged by the owner (main 0366edc); no migrations; reviewer memory now `reviewed.txt` on claude/coordinator-state. No newly READY module. |
- 12:55 UTC coordinator 20: PR #115 (reviewer memory in reviewed.txt on claude/coordinator-state; precheck counts only open PRs; replaces #113, closed); #114 warning-signs merged (bfd3813); #110 closed (superseded); #112 retargeted to main; main merged into #109 (ci.yml conflict), #89, #93, #100, #111, #112.
- | Merge #114 warning-signs | done | 2026-09-26 | 13:10 UTC: merged (main bfd3813); 2 migrations applied as `warning_signs_pr114`, ledger 101 = plan 101, md5 verified. No newly READY module (scan-lookup queued 03:10). |

## Retired
- Coordinator 20 `session_01BEer9ayz4asPCH8yCBnEAy` handed off 13:10 at 219k to coordinator 21 `session_01J8ySzngP3CXQpWTdhM5aPc` (control session, branch claude/coordinator-21). Coordinators 18 `session_01HGrc9KnH89KCTyrWsSoEz5` and 19 `session_01H4Arw9SQThm8T3VDs4W2pn` idle; do not wake.
- Coordinator 16 `session_01VTx2FS552iCMDrFaiH9ods`, coordinator 17 `session_01DRRHh7vDk4PTJnPngeyXZ4`: sessions stay idle; do not wake them.
