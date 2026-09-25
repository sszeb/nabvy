# Fleet and Routines improvement plan (coordinator 18, 2026-09-25 23:30 UTC)

This plan comes from two analyses the owner asked for at 23:00: a fleet audit (twelve agents covering sessions, PR pipeline, CI, docs and orchestration, each lens re-checked by a verifier, then a synthesis and a critic) and a redesign of the Routines (seven agents: the official Routines docs, GitHub mechanics, prompt economy and build lifecycle, then a designer and a critic). The full data sits in the control session's scratchpad. Costs are the `usage.cost_usd` of each session (from `get_session`/`list_sessions`). Routine-fired runs are not in the session list, so their costs are single measured runs. Figures marked est. are estimates.

## One-screen summary

- **Where the money went.** 130 interactive sessions cost $5,663.
  - One out-of-fleet web session, "Buildpack app development" (session_012J8dDJ1GUtySk77vK6SNjM, origin web, not seeded by the fleet), cost $2,375 and produced 36.9M output tokens. The owner should check that one separately.
  - Within the fleet: build sessions $948 (47), coordinators $741 (18), reviewers $684 (14), other $667, fix and finish sessions $247 (24).
  - By model: Opus 5.5 $4,222, Fable 5.1 $817, Sonnet 5 $623, Haiku 4.5 $1.
- **What drives cost is context held over many calls, not time.** Cost correlates with cache reads (r = 0.93), not with how long a session stays alive (r ≈ 0). 92 of 127 fleet sessions passed the handoff line in force at the time; builds reached 500–730k.
- **Routines are cheap per run but poll.**
  - Coordinator sweep: $0.62 even when it finds nothing.
  - Hourly reviewer: $0.38 when it finds nothing, $1.33 for a review (it ended at 119k against its 80k budget, because its prompt pointed at the 24 KB "Reviewer 10 brief").
  - Fixed cost about $17–40 a day.
- **Delay comes from waits between events.**
  - Up to 3 h from a merge to migrations and the next build (the 2-hourly sweep, then the hourly dispatcher).
  - Up to 1 h from CI green to a review. With 13 open PRs and one review per hour, the queue does not clear; PRs #81, #83, #85 and #89 waited 8–10 h.
  - Sessions stall on permission prompts (L2 for 2.5 h+).
- **CI runs everything, cold.** About 177 runs a day, no cache, no path scoping. A 5-line docs change took 12m55s for checks. PR #70 hit the 15-minute ceiling.

## Done tonight (control session, 23:30)

- Both reviewer Routines (`trig_011fjd2grZBEWR3FqfDzTWJR`, `trig_01FPLnjfTATPb7YQivWvA7FX`) now carry their rules inline. They no longer read `docs/session-conventions.md` or the long-session "Reviewer 10 brief", whose `fire_trigger` and handoff steps a fired run cannot carry out. The backstop now orders candidates as follows:
  1. the base of a stack;
  2. then the highest [cp N];
  3. then the oldest.

  The on-request run reviews even while CI runs, but does not merge until CI is green.
- On-request review runs fired for #83, #85 and #89. The fire for #81 was refused by the permission classifier; the hourly backstop or the owner can fire it.

## Owner actions (in the app)

1. `trig_01FPLnjfTATPb7YQivWvA7FX`: remove the "Pull request: Converted to draft" GitHub trigger (set by accident on 22:44); keep it API-only.
2. `trig_01SpUT9nZPtAH1FBGiQaCiwu` (coordinator): add GitHub trigger "Pull request: Closed" with filters **Is merged = true** and **Base branch = main** (both filters exist, VERIFIED in the Routines docs). Merge to migrations then takes about 1–2 min instead of up to 2 h; the 2-hourly sweep stays as the backstop.
3. Approve L2's pending permission prompt, and allow that tool class for the session.
4. Later, for the event chain below: generate API tokens for the reviewer (and the Fixer once it exists) and store them as GitHub repository secrets `REVIEW_FIRE_TOKEN` / `FIX_FIRE_TOKEN`. Never paste a token in chat.

## Target Routine set

| Routine | Trigger | Model | Replaces |
|---|---|---|---|
| Coordinator (existing) | GitHub "PR Closed", with Is merged and Base = main; cron `37 */2` backstop | Opus 5.5 | waiting up to 2 h for migrations |
| Reviewer (on request) | API, fired by a `notify-review` CI job when all checks pass; cron backstop `34 */2` once proven | Sonnet 5 | hourly polling; build sessions firing the reviewer |
| Fixer (new, fresh per fire) | GitHub "PR Labeled", with Labels is one of `changes-needed`, Base = main and Is draft = false; plus API from a `notify-fix` CI job on failure; cron `17 */4` backstop | Haiku 4.5 | 200–700k Opus build sessions kept alive on PR subscriptions |
| Builder (new, phase 2) | API with the module brief | Haiku 4.5 | dispatcher `create_session` of Opus builds |
| Dispatcher (existing) | cron `52 *` until phase 2 | Haiku 4.5 | retired in phase 2 |

The API endpoint is `https://api.anthropic.com/v1/claude_code/routines/{id}/fire`, with a per-Routine token that is shown once (VERIFIED). One fact is ASSUMED: that a label added by GitHub Actions' own token reaches Routines. So CI calls the API rather than relying on labels. The reviewer adds `changes-needed` through the GitHub API, which is the same path as a human label.

## Rollout order

The order matters: no step may point at a file or secret that does not exist yet.

1. Owner actions 1–3 above. Also delete the stale L1 and L2 poke Routines once those sessions finish.
2. **Docs and scripts PR** (Sonnet docs session). It adds:
   - `docs/routines/{reviewer,fixer,builder}.md`, each at most 2 KB;
   - `scripts/precheck.mjs`, with a fixture test; it ends a no-op run in one call when the main SHA and PR heads match state's Fingerprint;
   - `docs/secrets.md` rows (names only);
   - marks the Reviewer 9–14 paragraphs in `docs/session-conventions.md` as superseded.
3. Owner: creates the Fixer (and later the Builder) pointing at those files, and generates the tokens as repository secrets.
4. Control session: switches the coordinator's prompt to the pre-check and sliced reads (target: a quiet run under 40k, est. $0.40).
5. **ci.yml PR** (Haiku build session). Do not change PR #72's `runs-on`.
   - `types: [opened, synchronize, reopened, ready_for_review]`;
   - `notify-review` (needs all jobs) and `notify-fix` (`if: failure()`), both `continue-on-error: true`, guarded to same-repo non-draft PRs;
   - pnpm and turbo cache;
   - a docs-only skip done with job-level `if:` from a changed-files job, not `paths-ignore`, which would leave required checks at "Expected";
   - `turbo --filter=...[origin/main]` on PRs, with `fetch-depth: 0`;
   - `timeout-minutes` 15 → 20 as a stopgap.
6. After the chain works on 2 real PRs: reviewer cron to `34 */2`; delete the build sessions' `send_later` check-ins; drop "record migrations" from the reviewer.
7. Phase 2: test whether a fired run can call the Builder API with an environment secret. If it can, the coordinator starts builds directly and the dispatcher is retired.

## Other changes, ranked

- **Workflow agents.**
  - Never run workflow agents on the top model.
  - No workflows inside build sessions.
  - This is the 09-24 measurement: 104 of 108 workflow agents ran on the top model, using 2.5 times the coordinator's tokens.
- **Build and fix briefs.**
  - The 150k self-check happens at every wake.
  - Fix sessions read only the review, the diff and the module README.
  - 14 of 53 modules needed 2–3 sessions.
- **Dispatcher.**
  - It is a single point of failure.
  - Alert the owner when a wake is missed.
  - When its own context passes 150k, the owner starts a successor. It is at depth 7; its children are at depth 8 and cannot start sessions.
- **Conflict magnets.**
  - Only the coordinator regenerates `pnpm-lock.yaml`: 24 of 32 "merge main" commits touched it.
  - Move the seeder allow-list in `services/apify-gateway/test/conventions.test.ts` to per-module files: 7 of 32 merges touched it.
- **Split the docs.**
  - `docs/questions.md` (229 KB) keeps open questions only, under 10 KB.
  - `docs/decisions.md` (76 KB) keeps rules in force, under 20 KB, and moves history to an archive.
  - CLAUDE.md's first line should say that build sessions read only what their brief names.
- **Not yet measured:** the cache cost when a long-idle session wakes, for example after 14–17 h idle overnight. Compare the cache-write share on those wakes with fresh fires before deciding more.

## Do not change

- PR #72's runner decision.
- CI `cancel-in-progress`: 83 of 200 runs were correctly superseded.
- Any cron shorter than hourly: each fire costs about 40k tokens just to boot; use events instead.
- No session tools in fired runs; no new relay sessions.
- Model by job as set by the owner (19:58 and 20:02).
