# Implementation brief: fleet and Routines improvements (from coordinator 18, 2026-09-26)

**Owner decision, 2026-09-26: implement every recommendation now, with no pilots.** The relay split is the default for builds: a Builder run plans and writes a job note of at most 2 KB to the PR body, then works in slices; at 100k context (or at the end of a slice) it pushes, updates the note and hands on to the next run. Step F is in scope, and so are the docs slimming items. The work runs as three parallel workstreams, one session each, with no file overlap:

- **W1, Routines** (this brief's steps A, C, D and E, plus `builder.md` with the relay split): files `docs/routines/*.md`, `scripts/precheck.mjs` and its test, `docs/secrets.md`, and the superseded marks in `docs/session-conventions.md`. W1 also owns every Routine prompt change and the one owner list.
- **W2, CI and reconciler** (step B, then step F's `.github/workflows/dispatch.yml` + `scripts/dispatch.mjs` with a fixture test, per daisy-chain.md §2 and §5): files `.github/workflows/*`, `turbo.json`, `scripts/dispatch*`. The reconciler fires the Builder for READY modules (a Builder run whose note says "continue" is re-fired, at most 3 times), the reviewer for green unreviewed heads, the Fixer for `changes-needed` or red CI (at most 3 fix rounds, then `needs-human`), and the coordinator for merges with migrations. It honours the repository variable `CHAIN_LIVE`, logs every fire's HTTP status, and backs off on refusals. Tokens come from repository secrets only.
- **W3, docs slimming**: `CLAUDE.md` down to at most 3 KB (non-negotiables plus pointers; "How to work" and "Working economy" move to `docs/rules.md` unchanged in meaning, with a line that fired runs and build runs read only their role file and brief). `docs/questions.md` keeps open questions only (target under 10 KB; the rest goes to `docs/questions-archive.md`). `docs/decisions.md` keeps the rules in force (target under 20 KB; history goes to `docs/decisions-history.md`, and each superseded rule is replaced rather than footnoted). Update the pointers in `README.md` and in the briefs. Nothing in meaning may be lost: list every moved section in the PR body.

You implement the plan in `docs/routines/improvement-plan.md` (read it all, 9 KB), using `docs/routines/routines-design.md` and `docs/routines/daisy-chain.md` only as reference: read them by section with `sed -n`, never whole. Read `docs/security.md` before anything that touches tokens, webhooks, CI secrets or migrations. Work at medium effort, with no workflows. Use subagents only for reading, on Haiku. Follow CLAUDE.md: one PR per step, on a branch `task/<id>-<slug>`; fixture tests; lint and typecheck clean; no model identifiers in commits or PRs; no secrets in the repo or chat. Owner's standing rule: accept, confirm and go ahead. Ask the owner only for accounts, secrets, payments and prices.

## Order (never point a Routine at a file or secret that does not exist yet)

**Step A. PR "routines: role files and pre-check"** (task `0.20a-routine-files`). It adds:
- `docs/routines/reviewer.md`, at most 2 KB. It holds the reviewer rules that sit inline today in the prompt of Routine `trig_011fjd2grZBEWR3FqfDzTWJR`; take them from that prompt with `get_trigger`. It adds one rule: on "Changes needed" (or red CI found by the backstop), add the label `changes-needed` with `issue_write`.
- `docs/routines/fixer.md` and `docs/routines/builder.md`, each at most 2 KB, per routines-design.md §3.
- `scripts/precheck.mjs`, with a test under `scripts/` in the style of `check-conventions.test.mjs`.
  - `precheck.mjs coordinator` prints `QUIET` when the main SHA and the PR heads (`git ls-remote origin 'refs/pull/*/head'`) match the "Fingerprint:" line in state.md, and the queues "Merged, migrations pending", "Sessions to start" and "Messages to send" are empty.
  - `precheck.mjs reviewer` lists open PRs whose head has no review, using the GitHub REST API (`GITHUB_TOKEN` if present) or the plain `gh`-free `git ls-remote`.
- Rows in `docs/secrets.md` for `REVIEW_FIRE_TOKEN` and `FIX_FIRE_TOKEN` (names and purpose only).
- In `docs/session-conventions.md`, mark the Reviewer 9–14 paragraphs as superseded, in one line each.

Fire the reviewer on-request Routine `trig_01FPLnjfTATPb7YQivWvA7FX` with `PR #<n>: <title>` once CI is green.

**Step B. PR "ci: faster, scoped CI with Routine hooks"** (task `0.20b-ci-speed`). Do not change PR #72's `runs-on` or the `cancel-in-progress` concurrency. It adds:
- `cache: 'pnpm'` on each `actions/setup-node`;
- a `.turbo` cache keyed on the lockfile;
- `timeout-minutes` from 15 to 20 on the checks job;
- a docs-only skip: a first job lists changed files, and the other jobs get `if:`. Do not use `paths-ignore`, because required checks would sit at "Expected";
- on PRs, `turbo run typecheck test --filter=...[origin/main]` with `fetch-depth: 0`; keep the full run on pushes to `main`;
- `types: [opened, synchronize, reopened, ready_for_review]`;
- jobs `notify-review` (needs all jobs, on success) and `notify-fix` (`if: failure()`). They POST to `https://api.anthropic.com/v1/claude_code/routines/<id>/fire` with the secret token and text `PR #<n> sha=<head>`, guarded to same-repo, non-draft PRs. They carry `continue-on-error: true`, and skip cleanly when the secret is empty, so this PR can merge before the owner creates tokens.

Measure the CI time before and after on one PR, and put both numbers in the PR body.

**Step C. Routine prompts** (you do this with `update_trigger`, after A merges). If the session tools are missing, write the exact new prompts into state.md "Waiting on the owner" for coordinator 19.
- Coordinator `trig_01SpUT9nZPtAH1FBGiQaCiwu`: step 1 becomes `git fetch ... && node scripts/precheck.mjs coordinator`, and on `QUIET` the run ends with one line. Load Supabase tools only on the migration path. Read `docs/routines/coordinator.md` by section, not `sed -n '1,400p'`.
- Both reviewer Routines: point them at `docs/routines/reviewer.md`, and keep the owner rules line.
- After each change, measure the next run with `get_session` on its session id (cost and context). Record it in state.md "Docs to record".

**Step D. Owner, in the app.** Ask once, in one short list, when A and B have merged:
1. Remove the reviewer on-request "Converted to draft" trigger, if it is still there.
2. Coordinator: add "Pull request: Closed" with filters Is merged = true and Base branch = main.
3. Create the Fixer Routine: fresh session, Haiku 4.5, repo `sszeb/nabvy`, prompt pointing at `docs/routines/fixer.md`, and trigger "Pull request: Labeled" with Labels is one of `changes-needed`, Base = main, Is draft = false. Add an API trigger.
4. Generate API tokens for the reviewer and the Fixer, and save them as GitHub repository secrets `REVIEW_FIRE_TOKEN` and `FIX_FIRE_TOKEN`. Also save the Routine IDs as repository variables. Never in chat.

**Step E. Prove it on two real PRs.** For each, check:
- CI green fires the reviewer within minutes;
- `changes-needed` fires the Fixer;
- a merge fires the coordinator.

Then:
- set the hourly reviewer cron to `34 */2`;
- remove "record migrations" from the reviewer;
- delete the stale poke Routines `trig_01KmJ4pPZXoRKmXRTUhtMgMF` and `trig_01VD8NBTFhNtAp2SnxZTVuqw` once the L1 and L2 sessions are done.

**Step F (now, owner 2026-09-26; W2 and W1).** The zero-token reconciler (`dispatch.yml` + `dispatch.mjs`, per daisy-chain.md §2) and the Builder with the relay split as the default. Measure the first two builds (get_session cost per run) and record them; no pilot gate.

## Report
After each step, add one line to state.md "Docs to record" on `claude/coordinator-state`, as a fast-forward push only. Give the owner one short message per merged step. Hand off at 150k used tokens: write the successor prompt into state.md "Waiting on the owner" and ask the owner to start it from the app.
