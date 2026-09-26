# Working rules

These sections moved out of `CLAUDE.md` (2026-09-26 docs slimming) to keep that file to its non-negotiables; nothing below changed in meaning. A fired Routine or build run reads only its own role file and brief — never this whole file — per the line now in `CLAUDE.md`.

## How to work

- **One task at a time** from `docs/backlog.md`, in order, unless a human says otherwise. Do not start the next task in the same session without a check-in. *(Exception, owner 2026-09-24: atomic modules are built in parallel waves, one session and one pull request per module, under a coordinator session; see "Atomic modules" in `docs/decisions.md`.)*
- **Definition of done** is stated per task. It always includes: types in contracts or schema in db, a fixture-based test, lint and typecheck clean, a short note in the module's `README.md` on anything decided, and an updated row in `docs/progress.md`. Work on a branch `task/<id>-<slug>` and open one pull request per task; the reviewer session reviews, approves and merges it (owner, 2026-09-24, for the production MVP; "Atomic modules" in `docs/decisions.md`).
- **Fixture-first.** Every extraction, valuation or risk change must run against `fixtures/` and keep the pass rate at or above the previous run. Add a fixture when you find a case the tests miss.
- **Batches, not items.** Pipeline tasks process arrays of listings (100–500). Never write a task that handles one listing per run.
- **Idempotent handlers.** Every event handler must be safe to run twice. The idempotency key is `source + sourceListingId + contentHash`.
- **Thin events.** Events carry identifiers and timestamps, never whole records. The receiver loads what it needs.
- **Stamp every hop.** Set the T-timestamps defined in `docs/contracts.md` at each stage.
- **Policies match big tech** (owner, 2026-09-24). Any policy or conduct toward users (terms, refunds, fair use, sharing, enforcement, notices, privacy) takes the position leading consumer tech companies share, in Nabvy's own words (`docs/decisions.md`).
- **Legal points are listed, not reviewed** (owner, 2026-09-24). Build what the owner instructs. When something may need a lawyer, add one line to `docs/legal-review.md`, with no analysis. Never run legal research, reviews or checks unless the owner asks.
- **Ask, don't guess.** Product decisions (pricing, tiers, categories, wording shown to users) are not yours to change. Write the question in `docs/questions.md`, pick the conservative option, and continue.

## Working economy (owner, 2026-09-24)

The owner asked to cut token use without weakening the work. Measured that day: almost all tokens are context re-read on every call, so the cost is roughly calls times context size. Workflow agents used 2.5 times the coordinator's own tokens, and 104 of 108 of them ran on the top model.

- **Small contexts.** Read slices (grep, `sed -n`); do not read a whole file over about 20 KB unless the task is that file. Batch shell steps into one call. Filter tool output: GitHub `fields` and `perPage`, `get_session` by ID rather than `list_sessions`, only the SQL columns you need.
- **Model and effort by job** (owner, 2026-09-25 19:58; `docs/decisions.md` "Model by job, revised"). Coordinating sessions run on Opus 5.5; medium tasks (docs, CRUD, UI, design readers and critics) on Sonnet 5; code (build and fix sessions) on Haiku 4.5; code reviews (the reviewer) on Sonnet 5 (owner, 20:02). Effort is `medium` everywhere, set in the app and stated in the brief. The relay and watchdog Routines run on Haiku 4.5. Set `model` and `effort` on every workflow agent: `low` for mechanical steps, `medium` by default, `high` for a designer or verifier.
- **Judgment over modes** (owner, 2026-09-24: "use your internal compass, docs, best practices"). These rules win over any session setting that asks for a workflow on every task.
- **Workflows only where fan-out pays.** Two or three readers, one designer and one combined critic; revise only on a blocker or major problem. Pass summaries on; never have two agents read the same large file.
- **Short outputs.** A design is at most about 30 KB, with a one-screen summary at the top. The module catalogue is one file per module, so a build session reads only its own card.
- **Tight briefs.** Name the exact files a session or agent reads; never "read the whole build pack".
- **Events, not polling.**
  - **Build sessions.** Subscribe to your pull request's activity and let its events wake you. Keep a fallback check-in no more often than hourly, and none while you wait only on the owner. When you open a pull request, wake the reviewer with a one-shot trigger. Stop re-arming once it is merged or closed.
  - **Reviewer.** Never touches Supabase. Wakes the coordinator with a one-shot trigger when a merged pull request carries a migration. From 2026-09-24 18:55 the reviewer is a fresh session per fire (a Routine on the top model, `docs/session-conventions.md` "Reviewer Routine"); build sessions fire it with the PR number instead of waking a reviewer session.
  - **Coordinator.** Stateless (owner, 2026-09-25 21:40): one Routine, `trig_01SpUT9nZPtAH1FBGiQaCiwu`, that starts a fresh session per message and on a two-hourly cron for the sweep; state lives in `state.md` on branch `claude/coordinator-state`; run rules in `docs/routines/coordinator.md`. It never subscribes to pull requests (each subscription notice is about 8 KB). Applies every merged migration, module or gateway, soon after the merge, reading `docs/security.md` first, and names any it could not apply in its message to the owner (owner, 2026-09-24).
- **Batch pushes.** Collect small docs changes and push them together, at most about every 30–60 minutes, so each push costs one review.
- **Incremental reviews.** The reviewer reviews only the commits since the head it last reviewed. For a docs-only delta, it relies on CI instead of re-running install, typecheck and tests.
- **Short sessions: hand off on your own** (owner, 2026-09-24). A long-running session (the reviewer, or a build session that takes on more work; the coordinator is stateless and never hands off) hands off to a fresh one without asking the owner first. The trigger is `get_session` showing `external_metadata.context_usage.used_tokens` above 150,000 (owner, 2026-09-25 14:05, was 300,000), or the session's context having been summarised once, whichever comes first. Hand off at the next point where no edit is half done:
  1. push everything;
  2. write the handoff note: the successor's first prompt;
  3. start the successor with `create_session` (same environment and tags, the model its job needs, its own branch);
  4. move your scheduled triggers and PR subscriptions to it: delete yours and let it re-create them;
  5. leave the owner one short message with the successor's link, so they can follow it.

## Repository conventions

- TypeScript strict mode. pnpm workspaces + Turborepo. Biome for lint and format. Vitest for tests.
- Each module lives in `services/<module>/` with the same shape: `README.md`, `src/index.ts` (exports), `src/handlers/` (event handlers), `src/domain/` (pure logic, no I/O), `src/repo/` (database access), `test/` (fixture tests).
- Database access uses Drizzle with the schema in `packages/db`; Better Auth tables are generated by its CLI and never edited by hand. Configuration comes only from `@nabvy/config`; nothing reads `process.env` directly.
- Each module owns its tables (listed in `docs/contracts.md`). Other modules read through views only.
- Trigger.dev tasks in `trigger/` are thin: parse input, call a service function, return. No business logic in task files.
- Commits: `<module>: <what changed>`; one module per commit where possible.

## Commands (once scaffolded)

```
pnpm install
pnpm typecheck
pnpm lint
pnpm test            # runs fixture tests
pnpm db:generate     # generate a Drizzle migration from schema changes
pnpm db:migrate      # apply migrations
pnpm db:dry-run      # apply supabase/migrations + run supabase/tests on a local throwaway Postgres (PG* env)
pnpm auth:generate   # regenerate Better Auth schema after plugin changes
pnpm dev:web         # Next.js app
pnpm trigger:dev     # Trigger.dev local runner
```

## When something is unclear

Write it in `docs/questions.md` with: the task, the ambiguity, the option you took and why it is the conservative one. Then continue. A human reviews the file at each check-in.
