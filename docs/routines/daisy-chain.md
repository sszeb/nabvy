# Daisy-chained Routines (addendum to routines-design.md)

Produced by the daisy-chain workflow on 2026-09-25 (revision 2, after its critic), at the owner's request to use Routines to offload token usage. Note from coordinator 18: "no new relay sessions" in improvement-plan.md means no Routine bound to a long-lived session only to forward messages. It does not forbid splitting a build into short fresh runs; whether to do that (k-way split) is the owner's call, after the two-module pilot below. Cost fits here are exact because cost_usd is computed from token counts, so they are good for comparisons.


**Status.** This adds to `docs/routines/routines-design.md` (rev 2, after its critic) and `docs/routines/improvement-plan.md`. It does not compete with them. It keeps their Routine set (Coordinator, Reviewer, Fixer, Builder), their CI `notify-review`/`notify-fix` jobs and their tests R1–R11. It adds four things they lack: a zero-token reconciler in GitHub Actions, the builds started from Actions instead of from a fired run, in-run context offloading, and one place to see where a module is in the chain. It read `docs/security.md` before touching tokens, webhooks and migrations.

## One-screen summary

- **The bus is GitHub.** The primary bus is GitHub Actions calling each Routine's fire API with a token held as a repository secret. The fallback is the Routines' own PR triggers. A fired run calling the API with an environment secret (R5) becomes optional, not needed. That is a security gain: no Routine token ever sits in a Claude environment.
- **Zero-token gatekeeping.** `dispatch.yml` plus `scripts/dispatch.mjs` runs on `workflow_run`, `pull_request`, `push` to main and a 30-minute cron. It fires a Routine only for a real gap. The Routine crons drop to 4–6-hourly backstops.
- **Builds start from Actions.** Actions reads the READY list in `state.md` and fires the Builder. The Haiku dispatcher session goes away, and so does the need for R5.
- **No multi-hop relay by default.** The plan's "no new relay sessions" rule stands. A build is one Builder run. It continues in a second run only under the existing CLAUDE.md handoff line (150k tokens). A planned k=4 split is an **owner question** with a two-module pilot. No saving is claimed until that pilot is measured.
- **Context offloading** inside each run: a Haiku reader subagent, a 3 KB CLAUDE.md for fired runs, and role files of at most 2 KB.
- **Safety:**
  - a lock on the head SHA of each PR;
  - the fire API's response logged, with backoff and no blind re-fires;
  - a hop cap and `needs-human`;
  - a `CHAIN_LIVE` kill switch;
  - `workflow_run` guarded against fork PRs;
  - one sticky "chain status" comment per PR.
- **The biggest unknown is the daily run cap.** Stage 3 is gated on reading it. The fleet already fires 36 recurring runs a day with no recorded cap failure (VERIFIED, routines.md), so either scheduled fires are exempt or the plan is larger than Max. Either way the question is cost, not whether runs can happen.

## 1. The bus

| Option | Status | Use |
|---|---|---|
| **A. Actions → `POST …/routines/{id}/fire`** with `secrets.<ROLE>_FIRE_TOKEN`; text `PR #n sha=<head> hop=<h>` | Endpoint VERIFIED (research, routines docs). Runners reaching api.anthropic.com is ASSUMED (R3; needs a test: the first `notify-review` fire) | **Primary.** It is the only path that sees "CI finished" (no such Routine event exists, VERIFIED, routines.md). The token stays in GitHub's vault, in line with security.md ("secrets in platform vaults") |
| B. Routine PR triggers (Labeled, Closed with Is merged and Base = main) | Events and filters VERIFIED. Events over the hourly caps are silently dropped (VERIFIED) | **Fallback**, and for labels a human adds |
| C. Issue events as a job queue | CONFLICT: the docs list only PR and Release events; the editor shows Issue events (routines.md) | Not used. Needs a test: a throwaway Haiku Routine on "Issue: Labeled", about $0.05 |
| D. A fired run curls the API with an environment secret | Environment variables are readable by anyone using the environment (VERIFIED) | **Dropped** if A works. It would put a fire token in a shared Claude environment |

## 2. Zero-token gatekeeping (the reconciler)

`dispatch.mjs` is plain Node with a fixture test. It builds the desired state from GitHub (open PRs, labels, check runs, commit statuses) and from the `state.md` READY list. It fires only for gaps.

| Condition | Fires |
|---|---|
| Module READY; no branch, PR or `chain/build` status | Builder |
| Draft PR whose checklist says `continue`, CI done on head, no `chain/build` status on head | Builder (continuation; see §3) |
| Non-draft PR, all checks green, no `chain/review` status on head, and no `notify-review` fire logged for that head | Reviewer (a backstop to the CI job, which stays) |
| `changes-needed`, or red CI, with fewer than 3 fix attempts | Fixer (a backstop to `notify-fix` and R1) |
| Merge to main touching `supabase/migrations/**`, `supabase/functions/**`, `packages/db/**` or the gateway | Coordinator (a backstop to R2) |
| Anything else | nothing (0 tokens) |

The Routine crons become backstops for when Actions itself is down: the reviewer at `34 */4`, the Fixer at `17 */6` and the coordinator at 6-hourly. The coordinator change is an owner decision, because `coordinator.md` keeps a 2-hour rule (VERIFIED, routines-design.md §1). The reconciler covers that 2-hour window at no token cost.

## 3. Relay runs, within the owner's rules

`improvement-plan.md` "Do not change" says: "No session tools in fired runs; no new relay sessions" (VERIFIED). This design therefore keeps **one Builder run per module** (the plan's phase 2 Builder) as the default:

- **Builder** (Haiku, as model-by-job requires). It reads its module card and `docs/routines/builder.md` (at most 2 KB), opens a draft PR with a 2–4-slice checklist, builds, pushes, and marks the PR ready.
- **Continuation.** If the run crosses 150k tokens (the CLAUDE.md handoff line), it pushes, writes a "Next" note of at most 2 KB in the PR body, ticks `continue` and ends. The reconciler fires the same Builder again. The hop cap is 3. This applies an existing rule to fired runs; it is not a new relay Routine.
- **Fixer** (Haiku), **Reviewer** (Sonnet) and **Coordinator** (Opus) are as in routines-design.md.
- **Owner question.** A planned k-way split of every build (plan, slice, slice, finish).
  - The only evidence is a linear model: k=4 gives 0.47× the cache reads of one long session (ASSUMED).
  - The model is calibrated on a dataset whose fit is suspiciously exact (R² = 1.000), so the cost figures may be derived rather than billed (ASSUMED).
  - It also assumes Haiku needs no more calls than the top model did, and 14 of 53 modules already needed 2–3 sessions (VERIFIED, plan).
  - **No saving is claimed.** The cheapest test is R7 extended: build prepared-message and demand-signals with the default Builder, then read each run's `get_session` cost. Fired runs are measurable by ID (VERIFIED, routines.md). Compare those runs with the $20 average of today's build sessions (VERIFIED, plan) before anyone decides on k.
- **Environment precedent.** The 2024-09-24 fresh reviewer failed because it had no repository attached and did not load deferred tools (VERIFIED, session-conventions.md:47). Fresh runs now fetch branches and push `state.md` (VERIFIED, routines.md, coordinator prompt). Test R12 checks that a fired Builder can check out a new branch, commit, push and open a draft PR. It runs as a no-op module before stage 3.

## 4. Context offloading inside a run

- **Reader subagent** (`.claude/agents/reader.md`, `model: haiku`, read-only, returns at most 1 KB). The subagent model field and isolated contexts are VERIFIED (research). There is no `.claude/agents` directory today (VERIFIED, `ls`). That fired runs load it is ASSUMED, so test R13: one fired no-op run reads `docs/decisions.md` through the reader and reports the model used. Whether a single subagent counts under "no workflows inside build sessions" is an owner question.
- **CLAUDE.md** is 11,965 bytes (VERIFIED, `wc -c`) and is loaded on every call. Cut it to 3 KB or less (non-negotiables plus pointers) and move "How to work" and "Working economy" to `docs/rules.md`. The saving is about 2k tokens per call (ASSUMED).
- **Role files of at most 2 KB.** `coordinator.md` is 10,899 bytes (VERIFIED, `git show origin/claude/coordinator-16`). Split it into sweep and migrate parts.
- **`pnpm install` in the environment setup script.** It is snapshotted and reused for about 7 days (VERIFIED).
- **Connectors.** Builder, Fixer and Reviewer have none. Only the coordinator keeps Supabase.

## 5. Safety

Patterns from `docs/security.md`:

- **Verify and deduplicate** every inbound event, like Stripe and Telegram (security.md:29).
  - `dispatch.yml` has no public endpoint. It runs only on GitHub-native events.
  - A fired run treats its payload as a hint. It re-reads PR number, head SHA and labels from GitHub, and ends in one call if the SHA is no longer the head.
  - Deduplication uses a pending commit status `chain/<role>` on the head SHA, plus `concurrency: pr-<n>`. Commit statuses are ASSUMED (standard GitHub, not in the research).
- **Least privilege** (security.md:39). Workflow `permissions: statuses: write, pull-requests: write` (for labels and the status comment only), `contents: read`. The fire tokens are exposed only to the fire step.
- **Fork PRs.** Use `pull_request`, never `pull_request_target`. `workflow_run` runs with secrets even when a fork's CI triggered it. So the job's `if:` requires `github.event.workflow_run.head_repository.full_name == github.repository`, and the job never checks out or executes PR code; it reads only API metadata. Fork PRs are left to the backstops. Fork PRs get no secrets on `pull_request` (VERIFIED, routines-design.md:177).
- **gitleaks** stays in CI (security.md:21). Token names go in `docs/secrets.md`; values never appear in chat or the repo.

Caps and lost hops:

- The API returns a status, unlike dropped GitHub events.
  - On a non-2xx response (a cap, 429 or error), `dispatch.mjs` records it on the SHA's status, backs off 30, then 60, then 120 minutes, and does not count the attempt as a hop.
  - After 3 refusals in a day it stops firing and opens one alert issue.
  - What a cap refusal actually returns is ASSUMED. Needs a test: read the response to the first refused fire.
- A fire that was accepted but produced no commit within 60 minutes is re-fired **once**. The second silence gets `needs-human`. This stops the loop that would otherwise spend more cap during parallel waves.
- The script also keeps a daily fire budget (for example 40), counted from its own Actions run history.

Loop guards:

- at most 3 Builder continuations and at most 3 fix attempts;
- 3 review↔fix rounds lead to `needs-human`;
- `chain-stop` (per PR) and `CHAIN_LIVE=false` (global).

**Pausing mid-build.** When `CHAIN_LIVE` goes off, draft PRs sit as they are and the status comment says "paused". When it goes back on, the reconciler adopts whatever state it finds. Stale pending statuses are cleared, and each PR gets at most one fire.

**One place to look.** `dispatch.mjs` keeps a single sticky "chain status" comment per PR (0 tokens). It shows:

- the stage;
- the hop count;
- the last fire and its HTTP result;
- a link to the run;
- a collapsed history of earlier "Next" notes, so none are lost.

The Builder updates the module's `docs/progress.md` row at merge, as the definition of done requires.

## 6. Target chain against today

**Today** (VERIFIED, plan and routines.md): READY → sweep (≤2 h, Opus $0.62 per no-op) → dispatcher (≤1 h) → Opus build session (median 324k context, $20 average) → hourly review (≤1 h; queues of 8–10 h; $1.33) → the build session wakes at 200–700k context to fix → merge → sweep (≤2 h) → migrations. The fixed floor is $17–40 a day.

**Target** (costs ASSUMED; routines-design.md ranges):

```
READY pushed to state.md --push--> dispatch.yml (0 tok)
  -> Builder [API, Haiku, $1-3; continue only past 150k, max 3]
  -> CI -> notify-review (CI job) | reconciler backstop (0 tok)
  -> Reviewer [API, Sonnet, $0.6-1.3]
       -> changes-needed / red CI -> Fixer [API or Labeled, Haiku, $0.5-1] -> CI -> Reviewer
  -> merge -> Coordinator [PR Closed+merged (R2) | reconciler, Opus, $0.8-2]
       only when migrations/functions/db/gateway changed; else 0 tok
Backstops: reconciler every 30 min (0 tok); Routine crons every 4-6 h.
```

The time between hops falls from hours to CI time. The fixed floor falls from $17–40 a day towards the cost of the backstops. The true share of today's fires that find nothing is not measured.

## 7. Migration in three stages

| Stage | A PR does | The owner does | Useful because |
|---|---|---|---|
| **1. Reconciler, dry run** (after the plan's steps 1–5) | `dispatch.yml`, `dispatch.mjs` with a fixture test, the status comment, the fork guard, `CHAIN_LIVE=false`. Secret names in `docs/secrets.md`. The CLAUDE.md trim | Stores `REVIEW_FIRE_TOKEN` and `COORD_FIRE_TOKEN` as repository secrets. Reads the daily cap on the usage page (free). Sets `CHAIN_LIVE=true` after a day of clean logs | Zero-token backstops; one place to see status |
| **2. Fixer and offloading** | `fixer.md`, `reader.md`, the fix rules. **Drop "record migrations" from the reviewer only after R2 has fired correctly once** | Creates the Fixer and `FIX_FIRE_TOKEN`. Runs R1 and R13. Moves the Routine crons to 4–6-hourly | Build sessions stop idling at 200–700k context |
| **3. Builder from Actions** (gated on the cap read, R12 and the R7 pilot) | `builder.md` and the build rules. The coordinator keeps migrations only and never starts builds | Creates the Builder and `BUILD_FIRE_TOKEN`. Retires the dispatcher wake, its session and the stale L1/L2 pokes. Decides the k-split question | Interactive build sessions and the depth-7 lineage limit go away |

**For `docs/questions.md`:**

1. Should builds be split into a planned relay, or stay one run with a 150k continuation? The conservative option is one run.
2. Are single Haiku reader subagents allowed in build runs? The conservative option is no, until R13 passes.
3. Should the coordinator backstop move from 2-hourly to 6-hourly once the reconciler is live? The conservative option is to keep it 2-hourly.

Sources:

- `/home/user/nabvy/docs/security.md` (lines 21, 29, 39)
- `/home/user/nabvy/docs/routines/improvement-plan.md` ("Do not change", Target, Rollout)
- `/home/user/nabvy/docs/routines/routines-design.md` (§1, §2, §5)
- `/home/user/nabvy/docs/session-conventions.md:47`
- `/tmp/claude-0/-home-user-nabvy/d939a73e-c20e-553e-82fb-3d80213cad06/routines.md`
- `/home/user/nabvy/.github/workflows/ci.yml` (no notify jobs yet, VERIFIED)
- the research block

Nothing was edited, pushed or fired.