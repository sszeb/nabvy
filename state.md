# Coordinator state

Updated 13:10 UTC 2026-09-26 by coordinator (merge event: #114 warning-signs merged as bfd3813, 2 migrations applied as `warning_signs_pr114`, ledger 101 = plan 101, md5 verified). Earlier: (sweep 12:37: no merges, ledger 99 = plan 99; #114 warning-signs opened; docs batch 4fd62ac). Earlier: merge event 10:50 (#101 as 2fbe3b8). Setup check 2 (21:59): repo, state write, GitHub, Supabase ok; session tools absent in fired runs, so session starts and messages go through the dispatcher. Sweep cron `37 */2 * * *`. Last sweep: 12:37. Fingerprint: bfd3813; #113@f0f27cf,#112@0e837a1,#111@1881b8c,#110@2d2d13e,#109@ba09f25,#106@367a86d,#104@027acc2,#102@54dee1e,#100@6491d50,#98@bbebebb,#97@307961e,#96@420a386,#93@7ad5edf,#89@61cc5d9,#81@b08ee6b,#70@f7f3e11; ledger 101.

## IDs
- Coordinator Routine: `trig_01SpUT9nZPtAH1FBGiQaCiwu` (fresh session per fire; cron `37 */2 * * *` = sweep).
- Reviewer runs: on request `trig_01FPLnjfTATPb7YQivWvA7FX` (the old relay ID), hourly `trig_011fjd2grZBEWR3FqfDzTWJR` (the old watchdog ID).
- Dispatcher: `session_01LDvAXYfdUJv4TS7aT1ph7r` (Haiku, depth 7), woken by `trig_01FfBryD1G7vjpEVYpRxdSML` (`52 * * * *`).
- Old coordinator inboxes (1, 11 to 17) and reviewer 14's inbox deleted 22:30; build sessions firing them get a harmless error.
- Poke Routines: L1 web `trig_01KmJ4pPZXoRKmXRTUhtMgMF`, L2 wiring `trig_01VD8NBTFhNtAp2SnxZTVuqw`.
- Supabase project `rlgufxmsrkhyeiabdeic`. Trigger.dev project `proj_aazrktvhdfmimvxwxsnq` (secret key on the owner's PC only).

## Ledger
101 rows = plan 101 (13:10: #114 warning-signs applied as `warning_signs_pr114`, checksums and transcription md5 verified). Earlier: 99 rows = plan 99 (03:10: #108 asking-price-index applied as `asking_price_index_pr108`, checksums and transcription md5 verified). Earlier: 97 rows = plan 97 (checked 00:40: #85 attribution, #99 noise-filter, #92 search-planner applied 00:39, transcriptions verified). Nothing pending.

## Open PRs (sessions; details in docs/progress.md by grep)
- #113 scripts: precheck counts only open PRs [cp 0] — coordinator 19 (branch claude/exciting-cray-42nw7p); unreviewed. Fixes the always-BUSY coordinator pre-check.
- #111 asking-price-position [cp 6]: opened 08:53 by its queued session; unreviewed.
- #112 W3 docs slimming (base claude/coordinator-16; #101 merged 10:4x, so retarget #112 to main): `session_01B5g9DjscTSFaP122ZnWuDn`.
- #109 spec-match [cp 6]: last review (04:39, head 4944a85) approves; waits on CI (#110); head ba09f25 (timeout bump) since then unreviewed.
- #106 dispatch: zero-token reconciler (W2), #104 ci: faster scoped CI (W2) — `session_01WsDVema6i3QcYMjPNZK17M`.
- #102 router-gateway [cp 2], 2 migrations — `session_01ETdUVwpWrdfWdAPLvk8R8i` (Opus). On merge: start travel-time.
- #100 L2 pipeline wiring [cp 5] — `session_01EdCvNpwGNoqFD77bC9LGJa` (Haiku); blocked on a permission prompt the owner must approve.
- #98 check-scheduler (base #92 merged) — `session_018dmgrMJShzu2Mt83YDpxMx`.
- #97 demand-signals — `session_01Lq2CgBrjy6kZ6b7qTLWCM3`.
- #96 prepared-message [cp 5] — `session_011twSaUcxY8Ga8dmJHH3nHx`.
- #93 seller-reply-reports — `session_01U3VJw1mfZ6n1syQaHj7v3K`.
- #89 pickup-routes [cp 1], #81 listing-card [cp 5]: sessions in docs/progress.md.
- #70 price-drop-watch [cp 6] (changes-needed, review 5324943052: cross-pass relist under-announce + CI timeout) — round-1 session `session_013TTwsCCZGwSmh4kpgXT2pr` could not fire the fixer; round-2 fix session `session_01Sw7J2MCK4DVGz2Wg5Z9tdd` pushed f7f3e11 (12:35).
- #110 ci timeouts 15→25: superseded, main has the same change since #101 merged (48e70cd); close it unreviewed. PRs whose CI was cancelled need main merged in to pick up the timeouts.

## Sessions without a PR
- W2b `session_0184s4vadhBCiHcAW7ZNZRRW` (Sonnet, 08:21, owner-approved): finishes #104 (CI speed, Routine hooks, folds #110's timeouts) and #106 (reconciler, vars for Routine IDs, Builder fire path). Replaces W2 `session_01WsDVema6i3QcYMjPNZK17M` (context full; do not wake). W3 waits for the owner's confirmation in its own session.
- W3 docs slimming `session_01B5g9DjscTSFaP122ZnWuDn` (Sonnet): started 00:06 by coordinator 18 (W2 now has #104 and #106; owner 2026-09-26: implement all improvements now, no pilots; docs/routines/implementation-brief.md). W1 Routines implementer: the owner starts it from the app (it changes Routine prompts).
- L3 owner setup `session_013w6mgdrer6N4BGjUZSxMTE` (Sonnet): the owner talks to it directly (WSL Ubuntu, `scripts/wsl-bootstrap.sh`, `docs/local-run.md`).
- pasted-link-lookup, inventory: stacked on #81; open their PRs after #81 merges.

## Next starts
- scan-lookup [cp 1]: queued 03:10 (briefs/scan-lookup.md), no branch `task/w2-scan-lookup` or PR at 13:10; next sweep checks whether its session exists, else re-queue.
- listing-search when #81 merges (stack on listing-card).
- travel-time when #102 merges (`claude-haiku-4-5-20251001`, branch `task/w2-travel-time`).
- L3 runbook and L4 local acceptance after L1 and L2 merge.
- photo-review stays parked (owner).

## Waiting on the owner
- (12:00) Start coordinator 20 from the app (top model, medium effort, repo sszeb/nabvy at main, tags nabvy, nabvy-coordinator); coordinator 19 passed 150k at 11:52. First prompt: "You are Nabvy coordinator 20, the owner's control session (same brief as coordinator 19: answer the owner, check the fleet when asked, unblock stuck sessions, do session-tool work Routines cannot). Read CLAUDE.md and state.md on claude/coordinator-state; its "Workflow check" section is your fix list, in order. Read docs/routines/reviewer.md and docs/routines/fixer.md (2 KB each) before changing them; everything else by grep or sed -n slices. Coordinator 19 checked the new workflow at 12:00 UTC: merge -> coordinator and changes-needed -> Fixer work; the pre-check was always BUSY (fix in PR #113); reviewer markers cannot be pushed (HTTP 403 on refs/reviewed/*), so reviewer runs re-review heads and post duplicates while green heads wait. First turn: get_session on the dispatcher and on W2b, check PR #113, then start fix 1 (queue a Sonnet session with a brief in briefs/, or do it yourself if small). Hand off at 150k."
- Dispatcher: every create_session waits for your approval (pending again 11:52, for price-drop-watch-fix2). Pick "always allow" for create_session in "Nabvy dispatcher" if offered. It is at 132k of 200k.
- Reviewer (on request) `trig_01FPLnjfTATPb7YQivWvA7FX`: remove every GitHub trigger so it is API-only (plan action 1). Today one PR event starts two runs: duplicate reviews seconds apart on #104, #106, #107, #108, #109, #112.
- If not done: put the 08:24 regenerated reviewer token into the GitHub secret REVIEW_FIRE_TOKEN (never in chat).
- W2b `session_0184s4vadhBCiHcAW7ZNZRRW` idle since 08:36 at 190k, asking whether to monitor #104/#106 (both red). Answer it, or coordinator 20 replaces it.
- Weekly usage: sessions report the seven-day limit as "allowed_warning" (11:52).
- Agents cannot fire the Fixer Routine `trig_01UhN94zqkCRYjd7fjwSgKYF` (created via http_api); fix rounds go through the dispatcher until the owner recreates it from the app.
- Approve L2's pending permission prompt (session "Nabvy L2: pipeline wiring and local runner").
- `ROUTER_API_KEY` secret for router-gateway (owed since 16:45).
- Optional: detach unused connectors from the Nabvy environment (smaller context for every session).

## Workflow check (coordinator 19, 12:00 UTC)
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

## Sessions to start

## Messages to send

## Docs to record (the sweep writes these into docs/progress.md)
- | Merge #114 warning-signs | done | 2026-09-26 | 13:10 UTC: merged (main bfd3813); 2 migrations applied as `warning_signs_pr114`, ledger 101 = plan 101, md5 verified. No newly READY module (scan-lookup queued 03:10). |

## Retired
- Coordinator 16 `session_01VTx2FS552iCMDrFaiH9ods`, coordinator 17 `session_01DRRHh7vDk4PTJnPngeyXZ4`: sessions stay idle; do not wake them.
