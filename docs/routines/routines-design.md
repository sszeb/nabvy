# Routines redesign: full design (appendix to improvement-plan.md)

Produced by the routines workflow on 2026-09-25 (revision 2, after the critic). "routines.md" refers to the control session's data file of Routine configs and measured run costs, summarised in improvement-plan.md.


## Summary

**Spend now** (runs/day from the crons, `docs/routines/coordinator.md` on branch `claude/coordinator-16`, commit 18eb904, VERIFIED; cost per run from routines.md, VERIFIED):

| Routine | Runs/day | $ per run (measured) | $ per day |
|---|---|---|---|
| Coordinator sweep, Opus 5.5, `37 */2` | 12 | 0.62 for a no-op at 75k context (budget 60k) | **7.44** even when nothing happens |
| Reviewer hourly, Sonnet 5, `34 *` | 24 | 0.38 (boot floor) to 1.33 (full review, 119k context) | **9–32** |
| Dispatcher, Haiku 4.5, persistent | 24 | about 0.03 | about 0.7, but its context grows by about 29k per wake (ASSUMED) |
| **Fixed floor** | | | **about $17–40/day** |

Eight idle Opus build sessions are also still alive, some at 226k context (sessions.tsv).

**Latency now:**
- Merge to next build: up to 3 hours (up to 2 h for the sweep, then up to 1 h for the dispatcher).
- CI green to review: up to 60 minutes.
- CI red: nothing reacts until a build session notices, or the 4-hour stalled rule catches it (`coordinator.md:51`).

**Target** (every number below is ASSUMED until R8 is measured):
- **Fixed floor about $10/day**, with the 2-hour migration rule kept:
  - coordinator backstop: 12 runs at about $0.40;
  - reviewer backstop: 12 runs at about $0.40;
  - Fixer backstop: 6 Haiku runs;
  - dispatcher: about $0.7.
- **About $6/day** if the owner later agrees to a 6-hourly coordinator backstop (section 4, step 6).
- **Latency:** CI green to review about 1 min, CI red or Changes needed to a fix run about 1 min, merge to migrations about 1–2 min, merge to next build about 5 min in phase 2.

**Why a quiet sweep costs $0.62 (VERIFIED):** the quiet check needs step 3's `list_pull_requests` call (`coordinator.md:48,51`, about 80 KB returned). The run also reads the whole 10.9 KB rules file and calls ToolSearch twice.

## 1. Target Routines

Per-event costs are ASSUMED ranges built from the measured anchors (Opus no-op $0.62; Sonnet full review $1.33; Haiku wake $0.03). None has been run yet.

| Name | Session | Triggers | Model | Connectors | Notify | Replaces | $/day (ASSUMED) |
|---|---|---|---|---|---|---|---|
| **Coordinator** `trig_01SpUT9nZPtAH1FBGiQaCiwu` | fresh | GitHub *PR Closed*, filter Is merged = true and Base = main (R2). Cron `37 */2` kept (the 2-hour rule, `coordinator.md:89`) | Opus 5.5 | Supabase | push | the reviewer writing "migrations pending" (after R2 passes) | 12 × 0.40 + merges × **0.8–2.0** |
| **Reviewer** `trig_01FPLnjfTATPb7YQivWvA7FX` | fresh | API, fired by CI on green (R3). Cron backstop `34 */2` (R4) | Sonnet 5 | none | off | reviewer hourly `trig_011fjd2grZBEWR3FqfDzTWJR`; build sessions calling `fire_trigger` | 12 × 0.40 + reviews × **0.6–1.3** |
| **Fixer** (new) | fresh | GitHub *PR Labeled*, filter Labels is one of `changes-needed`, Base = main, Is draft = false (R1). API, fired by CI on failure. Cron backstop `17 */4` | Haiku 4.5 | none | off | build sessions kept subscribed to their PR; the 4-hour stalled rule | 6 × ~0.05 + fixes × **0.5–1** |
| **Builder** (new) | fresh | API only. Payload: `module; brief; branch task/<id>-<slug>; base <sha>` | Haiku 4.5 | none | off | the dispatcher's `create_session` of Opus builds | builds × **1–3** |
| **Dispatcher** `trig_01FfBryD1G7vjpEVYpRxdSML` | persistent session_01LDvAXYfdUJv4TS7aT1ph7r | cron `52 *` (hourly, including in the fallback). Retired in phase 2 | Haiku 4.5 | none | off | nothing; it now fires the Builder instead of `create_session` | ~0.7 |

A fresh fired run starts at lineage depth 0 (VERIFIED, `docs/session-conventions.md:13`). Models are set only in the Routine editor, never in prompts, commits or PRs.

## 2. Event chain

| Hop | Now | Target | Mechanism |
|---|---|---|---|
| Builder: draft PR, then ready | Opus session kept subscribed for hours | Haiku run ends after marking ready | Builder prompt |
| Push or ready → CI result | about 15 min | same | ci.yml `types: [opened, synchronize, reopened, ready_for_review]` |
| CI green → review | 0–60 min | **about 1 min**; backstop ≤2 h | `notify-review` job (`needs` all 4 jobs) calls `/v1/claude_code/routines/{id}/fire` (VERIFIED endpoint) with `PR #n head <sha>` |
| **CI red → fix** (any round, labelled or not) | a build session has to notice it | **about 1 min**; backstop ≤2 h (see below) | `notify-fix` job, `if: failure()`, which excludes cancelled runs, calls the Fixer's API in **ci-red mode**. That mode does not need the label |
| Changes needed → fix | minutes on a 200–400k Opus session, or 4 h | **about 1 min**; backstop ≤4 h | reviewer adds `changes-needed` with `issue_write` (VERIFIED tool), which fires the Labeled trigger (R1) |
| Fix pushed → re-review, or next fix | 0–60 min | CI time, then about 1 min | the same two CI jobs. No label is needed after a fix round |
| Approved and green → merge | same run | same run | reviewer |
| Merge → migrations | ≤120 min | **about 1–2 min**; backstop ≤2 h | merged-PR trigger (R2). The sweep's ledger check (`coordinator.md:50`) applies anything the event missed |
| → next build | ≤60 min | phase 1: ≤60 min. Phase 2: **about 1 min** | phase 2: the coordinator calls `curl` on the Builder API (R5) |

**Backstops for CI red:**
- The reviewer backstop finds any PR whose head is unreviewed and whose CI is red. It adds `changes-needed` with the verdict "CI red", and that routes into the Fixer's Labeled path.
- The Fixer backstop picks up any `changes-needed` label whose event was missed.

## 3. Prompt changes

Every prompt starts with the same line: *"If the file named below is missing on origin/main, follow your previous brief."* That makes the order of the rollout safe.

**Coordinator**
- Cut:
  - the two ToolSearch calls at the start (load Supabase only on the migration path);
  - the full read of `coordinator.md`. Read by slice instead: `sed -n '/^## Sweep/,/^## Applying/p'` for a sweep, `'/^## Applying/,/^## Build-session/p'` for a merge;
  - `list_pull_requests` in step 0. It now runs only in step 3, and only when the sweep is busy;
  - fetching 3 branches (fetch 2).
- Merge event: read `docs/security.md`, apply the PR's `supabase/migrations/*` changes, run `sweep.mjs`, and queue the READY modules.
- Sweep: when the ledger check applies a file that no merge run applied, write "missed merge event #n" under Docs to record. This measures R2 and R10.
- **Pre-check (1 call):**
  ```
  git fetch -q origin main claude/coordinator-state && node scripts/precheck.mjs coordinator
  ```
  It prints `QUIET` when the main SHA plus the `sha1sum` of `git ls-remote origin 'refs/pull/*/head'` match state's Fingerprint and the three queues are empty. On `QUIET`, end with one line.

**Reviewer.** The rules move to `docs/routines/reviewer.md`, at most 2 KB. The old pointer went to the stale "Reviewer 10 brief" (VERIFIED, `session-conventions.md:53`), which makes the reviewer read 24 KB.
- The rules:
  - verdict line first;
  - review the diff since the last reviewed head;
  - read CI results, never re-run them;
  - merge on Approved with green CI;
  - on Changes needed, or when a backstop finds CI red, add `changes-needed`;
  - claim the head before reviewing and record the verdict after, as lines in `reviewed.txt` on `claude/coordinator-state` (`node scripts/precheck.mjs claim|record`; pushes to `refs/reviewed/*` get HTTP 403, 2026-09-26);
  - no Supabase.
- Cut "skip if CI is running". Cut "record migrations" once R2 has passed.
- **API pre-check (2 calls):**
  1. `pull_request_read get`: exit if the PR is closed or a draft, or its head differs from the payload.
  2. `get_reviews`: exit if the last review's `commit_id` equals the head.
- **Backstop pre-check (1 call):** `node scripts/precheck.mjs reviewer` lists open PRs whose head has no line in `reviewed.txt` (`review`) and heads approved while CI ran (`merge`). If there are none, end. This does not use the search qualifier `status:success`: it is ASSUMED to reflect the legacy Commit Status API rather than the Checks that Actions writes, so it could hide exactly the PRs the backstop exists for.

**Fixer (new).** The prompt lives in `docs/routines/fixer.md`, about 1 KB.
- **Pre-check (at most 2 calls):**
  1. `pull_request_read get`: exit if the PR is closed or a draft, carries `fixing` or `fix-stuck`, or (API mode) its head differs from the payload. Label mode also needs `changes-needed`. CI mode needs a failed check run on the head.
  2. **Lock:** `issue_write` sets the labels to remove `changes-needed` and add `fixing` and `fix-r<N>`, where N is the highest existing `fix-r` label plus 1. Labels survive rebases and edited commit messages; commit titles do not.
- If N would be 4: add `fix-stuck`, write `docs/questions/<module>.md`, and end.
- Otherwise read the review or CI log, push one commit, remove `fixing`, and end.
- **Backstop:** `search_pull_requests` for `is:open is:pr base:main label:changes-needed -label:fixing -label:fix-stuck` (perPage 3). Also clear any `fixing` label on a PR not updated in 2 h, because a crashed run leaves it behind.

**Builder (new).** The prompt lives in `docs/routines/builder.md`: the Build-session brief without step 4 (`coordinator.md:75`).
- **Atomic lock (1 call):**
  ```
  git push --force-with-lease=refs/heads/task/<id>-<slug>: origin <base>:refs/heads/task/<id>-<slug>
  ```
  The empty lease value means the branch must not exist yet. GitHub checks that on its side, so if two fires race, the second push is rejected and that run exits (R11).
- Open a draft PR and mark it ready when done.
- Cut `fire_trigger`, `subscribe_pr_activity` and the hourly check-ins. A fired run cannot use session tools (VERIFIED), and CI now sends the signals.

**Dispatcher (phase 1)**
- Pre-check: `git show origin/claude/coordinator-state:state.md | sed -n '/^## Sessions to start/,/^## /p'`. If it is empty, reply "idle".
- Otherwise call `fire_trigger` on the Builder and note "fired <module> <time>" in the queue line, so the same module is not fired twice.

## 4. What to retire, and the order

**Delete:**
- `trig_01KmJ4pPZXoRKmXRTUhtMgMF` and `trig_01VD8NBTFhNtAp2SnxZTVuqw` (stale Poke Routines).
- `trig_01FHx7g7R8N3ZaZBAy8ueT2M`, after PR #70 is resolved.
- `trig_011fjd2grZBEWR3FqfDzTWJR`, at step 5.
- `trig_01FfBryD1G7vjpEVYpRxdSML`, in phase 2.
- The build sessions' `send_later` check-ins (find them with `list_triggers`).

**Archive once their PRs merge** (Opus build and fix sessions): session_01Lq2CgBrjy6kZ6b7qTLWCM3, 018dmgrMJShzu2Mt83YDpxMx, 011twSaUcxY8Ga8dmJHH3nHx, 01PAUb9EWufR4DsmqKijgCpk, 01ETdUVwpWrdfWdAPLvk8R8i, 014FfP4BL46j5zAsswC6BjjM, 01U3VJw1mfZ6n1syQaHj7v3K, 01Q7DmZPh2dxYb9NgrE1wukx, 013TTwsCCZGwSmh4kpgXT2pr. In phase 2, also archive session_01LDvAXYfdUJv4TS7aT1ph7r (the dispatcher).

**Order.** No step references a file or secret that an earlier step has not created.

0. **Now (no dependencies).**
   - Owner, in the app: remove the reviewer's "Converted to draft" trigger (a live bug, `routines.md:4`).
   - Control session: delete the Poke Routines.
1. **Files PR to main** (Sonnet docs session; no behaviour change):
   - `docs/routines/{reviewer,fixer,builder}.md`;
   - `scripts/precheck.mjs`, with a fixture test;
   - `docs/secrets.md` rows for `REVIEW_FIRE_TOKEN`, `FIX_FIRE_TOKEN` and `BUILDER_FIRE_TOKEN` (names only);
   - mark the Reviewer 9–14 paragraphs as superseded.

   Merge it before step 2.
2. **Owner, in the app:**
   - Create the Fixer and the Builder (model, triggers, prompts pointing at the merged files).
   - Add the merged-PR trigger to the coordinator.
   - Generate the API tokens. Store the review and fix tokens as repository secrets, and the Routine IDs as repository variables. Never paste a token in chat.
3. **Control session:** `update_trigger` the prompts of the coordinator, reviewer and dispatcher. Crons stay as they are.
4. **ci.yml PR** (Haiku build session; no model names; PR #72's `runs-on` untouched; new jobs copy `ubuntu-24.04`):
   - add the `types` line;
   - add `notify-review` and `notify-fix`, both with `continue-on-error: true` so a failed call never turns CI red, and both guarded with `github.event_name == 'pull_request' && !github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository`.

   Merge it only after step 2's secrets exist. Until then, the hourly reviewer still covers reviews.
5. **After R1, R2 and R3 each pass on 2 real PRs:**
   - reviewer cron to `34 */2`; delete `trig_011f…`; delete the `send_later` check-ins;
   - drop "record migrations" from the reviewer.
6. **Owner decision (optional).** Change the rule "within two hours" (`coordinator.md:89`) to six hours, and then set the cron to `37 */6`. Only do this after 7 days with zero "missed merge event" lines.
7. **Phase 2:** run R5. If it passes, the coordinator fires the Builder directly and the dispatcher is retired. If it fails, keep the dispatcher at `52 *`, which keeps phase 1 at ≤60 min.

## 5. Risks and cheapest tests

| # | ASSUMED | Cheapest test | Fallback |
|---|---|---|---|
| R1 | A label the reviewer adds through the app fires the Labeled trigger, and the filter is evaluated on the label that was added | Owner adds `changes-needed` by hand on one PR and checks the Fixer's run history | Fixer backstop cron (≤4 h) |
| R2 | A merge done by the reviewer delivers *Closed, Is merged* | Next merge: check the coordinator's run history | the 2-hourly sweep's ledger check |
| R3 | Runners reach api.anthropic.com; API fires count toward the daily run cap | First PR after step 4; check usage at claude.ai/code/routines | reviewer backstop |
| R4 | One Routine can hold API, cron and GitHub triggers together (API plus GitHub is VERIFIED) | Try it in the editor | two Routines with the same prompt |
| R5 | A fired run can read an environment secret, and the network allows the API | `test -n "$BUILDER_FIRE_TOKEN" && curl -o /dev/null -w '%{http_code}'` against a no-op Routine | keep the dispatcher at `52 *` |
| R6 | `refs/pull/*` works through the git proxy (pushes to `refs/reviewed/*` do not: HTTP 403, so `reviewed.txt` on a branch replaced them); `get_check_runs` reflects Actions results | One command each in the control session | `search_pull_requests is:open` plus `get_reviews` per PR |
| R7 | Haiku holds up on hard modules (the only evidence is the 0.9b trial: $0.60, one round) | Run the Builder on prepared-message and demand-signals first | `fix-r3`, then `fix-stuck` and a question |
| R8 | A no-op run ends near 40k context (about $0.40) | Read `get_session` on the next quiet sweep | trim the prompt further |
| R9 | Duplicate fires (VERIFIED: a GitHub trigger fires on every matching event) | covered by the label lock, the payload SHA check and the atomic branch lock | none |
| R10 | Hourly GitHub-trigger caps exist per Routine and per account (VERIFIED); their values are not documented | Owner reads them at claude.ai/code/routines; the "missed merge event" count is the symptom | backstops at ≤2 h (review, migrations) and ≤4 h (Fixer). Filters keep the event volume low |
| R11 | `--force-with-lease=<ref>:` with an empty value rejects a push to a ref that already exists, through the proxy | Push the same scratch ref twice; the second push must fail | dispatcher dedupe line |

Other points:
- Fork PRs get no secrets (VERIFIED), so the `if:` guard skips them and the backstops cover them.
- CI on pushes to `main` does not call the Fixer.
- Auto-fix on the Behavior tab stays off. It is an optional later test on the Builder.