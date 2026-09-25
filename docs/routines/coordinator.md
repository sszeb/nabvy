# Coordinator run rules

The fleet runs on stateless Routines (owner, 2026-09-25, 21:40 and 22:00; `docs/decisions.md` "Stateless coordinator"). Each fire starts a fresh session that does one job and ends, so nothing accumulates context and nothing hands off.

| Routine | ID | Fires | Job |
|---|---|---|---|
| Nabvy coordinator (inbox and sweep) | `trig_01SpUT9nZPtAH1FBGiQaCiwu` | cron `37 */2 * * *`; or a session fires it with a message | one message, or the sweep |
| Nabvy reviewer (on request) | `trig_01FPLnjfTATPb7YQivWvA7FX` | a build session fires it with "PR #n: ...; [cp N]" (the old relay ID) | review that PR, merge on Approved |
| Nabvy reviewer (hourly) | `trig_011fjd2grZBEWR3FqfDzTWJR` | cron `34 * * * *` (the old watchdog ID) | review the highest-[cp] PR whose head has no review |
| Nabvy dispatcher wake | `trig_01FfBryD1G7vjpEVYpRxdSML` | cron `52 */2 * * *` | wakes the dispatcher session `session_01LDvAXYfdUJv4TS7aT1ph7r` |

**What a fired run can and cannot do** (measured 2026-09-25, 22:00). It can read and push the repository (when the Routine has the repository attached in the app), use GitHub tools and use the Supabase connector (when attached). Load all of them with ToolSearch first; they are deferred and look absent until searched. It has **no session tools**: no `create_session`, `fire_trigger`, `get_session` or `get_trigger`. So a run never starts a session or messages one itself. It queues the work in `state.md` and the **dispatcher** (a small long-lived session, which has session tools) carries it out at minute 52 of every even hour.

Target: under 60k tokens per coordinator run, 80k per reviewer run. The coordinator setup check at 22:00 used 74k tokens ($0.51) including tool loading.

## Where things live

- **`state.md`** on the orphan branch `claude/coordinator-state`: IDs, open PRs and sessions, the ledger count, "Merged, migrations pending" (written by reviewer runs), "Sessions to start" and "Messages to send" (for the dispatcher), "Waiting on the owner", "Docs to record". Build briefs are files `briefs/<module>.md` on the same branch. It is operational: never merged, no PR, not reviewed. Keep `state.md` under about 8 KB.
- **Docs PR:** branch `claude/coordinator-16`, PR #101 into `main`, the one rolling coordinator docs PR. Only the sweep pushes to it.
- **History:** `docs/handoff-archive.md` (coordinators 1 to 17). Slices only.

## Writing state.md back

```
git fetch -q origin claude/coordinator-state
git worktree add -q -f /tmp/state origin/claude/coordinator-state   # detached
# edit /tmp/state/state.md (and add briefs/<module>.md); update the "Updated" line
git -C /tmp/state add -A && git -C /tmp/state commit -qm "state: <what changed>" && git -C /tmp/state push -q origin HEAD:claude/coordinator-state
```

On a rejected push (another run wrote first): `git -C /tmp/state fetch -q origin claude/coordinator-state && git -C /tmp/state reset -q --hard origin/claude/coordinator-state`, re-apply your change, push again. Never force-push.

## Token budget

- **Never subscribe to a PR.** Each subscription delivers an 8 KB notice; coordinator 16 spent 140k of 167k tokens on 17 of them.
- `list_pull_requests` with `minimal_output` still returns about 80 KB for 15 PRs. Call it only in the sweep, and read the saved file with `jq -r '.[] | "\(.number) \(.head.ref) \(.head.sha[0:7]) \(.updated_at) \(.title[0:60])"'`. For a single PR, `pull_request_read` `get`.
- Slices only (`grep`, `sed -n`); no file over about 20 KB whole. `docs/progress.md` (39 KB) by `grep -n`. No workflows or subagents.

## By message kind (a session fired the coordinator with text)

- **"Merged PR #n ...; migrations: ..."** → apply them ("Applying a merged migration"), then `git fetch -q origin main && node scripts/sweep.mjs --no-fetch`, and queue a build session for every module newly READY ("Build-session brief"). Update state.
- **"<module>: PR #n opened"** → add it to state's open PRs. No subscription.
- **"<session> at <tokens>: hand-off needed"** → queue a fresh session on that branch (`claude-haiku-4-5-20251001`, briefed from the PR and the latest review), and queue a one-line stand-down under "Messages to send" if state lists a poke Routine for the old one.
- **A question or blocker from a session** → if the docs answer it, queue the answer under "Messages to send" (its poke Routine); otherwise add it to "Waiting on the owner" and a "Docs to record" line for `docs/questions.md`.

## Sweep (cron fire, no appended text)

1. `git fetch -q origin main && node scripts/sweep.mjs --no-fetch`.
2. Migrations: apply every line under "Merged, migrations pending" (reviewer runs write them) and remove each once applied and checked. Then compare the ledger (`select count(*) from nabvy_core.schema_migrations`) with the plan size; apply any other missing file whose merge to `main` is over 30 minutes old.
3. `list_pull_requests` (open, perPage 15, `minimal_output`), read as above: reconcile state's open PRs (new in, merged or closed out). A PR whose head has not moved in four hours and whose last review says "Changes needed" is stalled: queue a fresh fix session for it (from the PR and the review) and note it for the owner.
4. Queue a session for every READY module that is not open, building or already queued.
5. Docs batch on `claude/coordinator-16`: fold `docs/questions/*.md` into `docs/questions.md` and delete them; write "Docs to record" into `docs/progress.md` (and `docs/questions.md` or `docs/decisions.md` where a line says so); `git merge -q origin/main` first if the PR conflicts; commit `docs: coordinator sweep <HH:MM>`; push. Clear "Docs to record".
6. State: the "Last sweep" line.

## Applying a merged migration

Read `docs/security.md` first (`CLAUDE.md` requires it). The Supabase project ref is `rlgufxmsrkhyeiabdeic`.

1. `node packages/db/scripts/migrate.mjs plan`.
2. `node packages/db/scripts/migrate.mjs emit <module>/<file>` for each file of the merge.
3. Apply all of a merge's emitted SQL in one Supabase `apply_migration`, named `<module>_pr<n>`.
4. Check the ledger rows and checksums.
5. Check the transcription: `select md5(regexp_replace(array_to_string(statements,''), '[\s;]', '', 'g')) from supabase_migrations.schema_migrations where name = '<the apply_migration name>'` must equal `python3 -c "import hashlib,re,sys;print(hashlib.md5(re.sub(r'[\s;]','',open(sys.argv[1]).read()).encode()).hexdigest())" <emitted file>`.

If the Supabase tools are missing from the run, apply nothing: leave the lines pending, add "Supabase connector missing on the coordinator Routine" to "Waiting on the owner", and say so in the final message.

## Build-session brief (queued for the dispatcher)

Write the brief to `briefs/<module>.md` on the state branch, and add a line under "## Sessions to start": `- <module>: model <model id>; branch task/<id>-<slug>; base <revision, usually main>; brief briefs/<module>.md`. Model by job (`docs/decisions.md` "Model by job, revised"): `claude-haiku-4-5-20251001` for code (build and fix), `claude-sonnet-5` for docs, CRUD and UI. The brief states, in this order:

1. "Run at medium effort." The module and its critical-path priority `[cp N]`.
2. The job in at most four numbered steps.
3. "Read first, only these": `CLAUDE.md` (automatic), the module card `docs/design/modules/<module>.md`, `docs/design/modules/_rules.md`, `docs/session-conventions.md`, and the READMEs of the modules it depends on. Everything else as slices.
4. Reporting: open the PR; fire the reviewer `trig_01FPLnjfTATPb7YQivWvA7FX` with "PR #n: <title>; migrations: <files>; [cp N]" when the PR is ready, and again after pushing fixes for a "Changes needed" review; fire the coordinator `trig_01SpUT9nZPtAH1FBGiQaCiwu` with "<module>: PR #n opened"; subscribe to its own PR only; questions to `docs/questions/<module>.md`.
5. The 150k line: over it with work left, fire the coordinator with "<session> at <tokens>: hand-off needed" and stop.
6. No model identifiers in commits or PRs; the non-negotiables in `CLAUDE.md` apply.

The dispatcher is lineage depth 7, so the sessions it starts are depth 8: they cannot use `send_later` or `create_trigger` (PR subscription events still wake them). When that matters, the owner starts a new dispatcher from the app (depth 0) with the brief below.

## Dispatcher brief

The dispatcher is `session_01LDvAXYfdUJv4TS7aT1ph7r` (Haiku, started 22:03 by coordinator 16). Its first prompt, reusable for a successor started from the app, is in that session. The short version: on each wake, `get_session` on itself (over 150k: add "- Dispatcher at <tokens>: start a new one from the app" under "Waiting on the owner" and stop). Then read "Sessions to start" and "Messages to send" from `state.md`. For each session line, `create_session` (source_url the repository, source_revision base, outcome_branch branch, model, title "Nabvy build: <module>", tags nabvy and nabvy-build, prompt = `briefs/<module>.md` verbatim). For each message line, `fire_trigger`. Remove the done lines, log them under "Docs to record", push `state.md`, and end with one line. It never reviews, merges, edits docs or touches Supabase. A successor needs its own bound cron Routine (`52 */2 * * *`), and the old "Nabvy dispatcher wake" deleted.

## Owner rules for the coordinator

- Accept, confirm and go ahead. Ask the owner only for accounts, secrets, payments and prices; never ask for a secret in chat.
- The current goal is milestone L (`docs/backlog.md`): the whole app running locally on the owner's PC for one user. photo-review stays parked.
- Apply every merged migration, module or gateway soon after the merge (within two hours, at the next sweep); reviewer runs never touch Supabase.
- The owner sets each Routine's model, repository and connectors in the app (claude.ai/code/routines); a session never changes a Routine's model.

## Old IDs

Old coordinator inboxes (coordinators 11 to 17) forward, hop by hop, to the coordinator Routine; no brief needs them any more. Reviewer 14 (`session_01S1zLkd1F9tHKsNc1MiwKF5`) stopped at 19:37 at 322k tokens; its inbox `trig_01HBnPvViK2spaRpcTnCv8du` is obsolete (fired Routines could never reach it, which is why reviews stalled from 19:37 to 22:00).
