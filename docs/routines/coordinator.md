# Coordinator run rules

The coordinator is **stateless** (owner, 2026-09-25, 21:40; `docs/decisions.md` "Stateless coordinator"). It is one Routine, **`trig_01SpUT9nZPtAH1FBGiQaCiwu` "Nabvy coordinator (inbox and sweep)"**, that starts a fresh session every time it fires:

- **Fired with appended text** (by a reviewer, a build session, the relay, the watchdog or an old forwarding inbox): an inbox message. Handle that one message.
- **Fired by its cron** (every two hours, minute 37): the sweep.

Each run reads two things up front, `state.md` on branch `claude/coordinator-state` and this file, does its one job, writes `state.md` back and ends. There are no hand-offs, no successor sessions and no inbox repointing: the Routine ID never changes. Target: under 60k tokens per run.

## Where things live

- **`state.md`** on the orphan branch `claude/coordinator-state`: current IDs, open PRs and their sessions, sessions without a PR, the ledger count, what starts next, what waits on the owner, and "Docs to record". It is operational state: never merged, no PR, not reviewed. Keep it under about 8 KB; drop lines that no longer matter.
- **Docs PR:** branch `claude/coordinator-16`, PR #101 into `main`, the one rolling coordinator docs PR. Only the sweep pushes to it (one review per two hours at most). Merge runs add a line to "Docs to record" instead.
- **History:** `docs/handoff-archive.md` (coordinators 1 to 17). Read a slice of it only when state or a message points there.

## Writing state.md back

```
git fetch -q origin claude/coordinator-state
git worktree add -q -f /tmp/state origin/claude/coordinator-state   # detached
# edit /tmp/state/state.md (update the "Updated" line: time and what this run did)
git -C /tmp/state commit -qam "state: <what changed>" && git -C /tmp/state push -q origin HEAD:claude/coordinator-state
```

On a rejected push (another run wrote first): `git -C /tmp/state fetch -q origin claude/coordinator-state && git -C /tmp/state reset -q --hard origin/claude/coordinator-state`, re-apply your change, push again. Never force-push.

## Token budget (measured 2026-09-25)

- **Never subscribe to a PR.** Each `subscribe_pr_activity` delivers an 8 KB notice; coordinator 16 spent 140k of 167k tokens on 17 of them in five minutes. Merges arrive by the reviewer's message, new PRs by the build session's message, and the sweep lists open PRs.
- **Large-output calls.** `list_pull_requests` with `minimal_output` still returns about 80 KB for 15 PRs (every body). Call it only in the sweep; when the result is saved to a file, read it with `jq -r '.[] | "\(.number) \(.head.ref) \(.head.sha[0:7]) \(.updated_at) \(.title[0:60])"'`. A single PR: `pull_request_read` `get`. `list_triggers` returns every stored prompt (about 15 KB): use `get_trigger` by ID. `list_sessions` is about 2 KB a session: use `get_session` by ID.
- **Reads.** Slices only (`grep`, `sed -n`); no file over about 20 KB whole. `docs/progress.md` (39 KB) by `grep -n`.
- **No workflows or subagents.**

## By message kind

- **"Merged PR #n ...; migrations: ..."** → apply that merge's migrations ("Applying a merged migration" below), then `git fetch -q origin main && node scripts/sweep.mjs --no-fetch`, then start a build session for every module newly READY (brief below). State: remove the PR, add the sessions, update the ledger count, add a "Docs to record" line.
- **"<module>: PR #n opened"** → add it to state's open PRs. No subscription.
- **"<session> at <tokens>: hand-off needed"** → start a fresh session on that branch (`claude-haiku-4-5-20251001`, briefed from the PR and the review), and tell the old one to stand down in one line (its poke Routine in state, or create one: `create_trigger`, `persistent_session_id` = that session, no schedule; record it in state). Update state.
- **"Reviewer N at <tokens>: hand-off needed"** → create the new reviewer session (`claude-sonnet-5`, brief: the reviewer paragraphs in `docs/session-conventions.md`, naming `trig_01SpUT9nZPtAH1FBGiQaCiwu` as the coordinator); create its inbox Routine bound to it (the prompt of the current reviewer inbox, via `get_trigger`, with the new N and this Routine's ID); repoint the relay step 1 and the watchdog step 3; delete the old reviewer's inbox; update state.
- **Relay or watchdog failure** → re-arm or repoint as the message says.
- **A question or blocker from a session** → answer from the docs through its poke Routine if you can; otherwise add it to state "Waiting on the owner" and a "Docs to record" line for `docs/questions.md`.

## Sweep (cron fire, no appended text)

1. `git fetch -q origin main && node scripts/sweep.mjs --no-fetch`.
2. `list_pull_requests` (sszeb/nabvy, open, perPage 15, `minimal_output`), read as above; reconcile state's open PRs (new ones in, merged or closed ones out).
3. Supabase: `select count(*) from nabvy_core.schema_migrations`. If below the plan size, find the missing files (`node packages/db/scripts/migrate.mjs plan` against `select module || '/' || name from nabvy_core.schema_migrations`) and apply those whose merge to `main` is over 30 minutes old (a merge run may be applying newer ones).
4. `get_session` only on sessions state flags, or whose PR head has not moved in two hours; one over 150k or failed gets a fresh session and a one-line stand-down.
5. Start a session for every READY module not already open or building (state "Next starts" and `sweep.mjs`).
6. Docs batch on `claude/coordinator-16`: fold `docs/questions/*.md` into `docs/questions.md` and delete them; write "Docs to record" into `docs/progress.md` (and `docs/questions.md`, `docs/decisions.md` where a line says so); `git merge -q origin/main` first if the PR shows a conflict; commit `docs: coordinator sweep <HH:MM>`, push, update PR #101's head line. Clear "Docs to record".
7. State: "Last sweep" and anything above.

## Applying a merged migration

Read `docs/security.md` first (`CLAUDE.md` requires it). The Supabase project ref is `rlgufxmsrkhyeiabdeic`.

1. `node packages/db/scripts/migrate.mjs plan`.
2. `node packages/db/scripts/migrate.mjs emit <module>/<file>` for each file of the merge.
3. Apply all of a merge's emitted SQL in one Supabase `apply_migration`, named `<module>_pr<n>`.
4. Check the ledger rows and checksums.
5. Check the transcription: `select md5(regexp_replace(array_to_string(statements,''), '[\s;]', '', 'g')) from supabase_migrations.schema_migrations where name = '<the apply_migration name>'` must equal `python3 -c "import hashlib,re,sys;print(hashlib.md5(re.sub(r'[\s;]','',open(sys.argv[1]).read()).encode()).hexdigest())" <emitted file>`.

If the Supabase tools are missing from the run, apply nothing: put "migrations of PR #n not applied: no Supabase connector on the coordinator Routine" in state "Waiting on the owner" and in the final message.

## Build-session brief

`create_session` in this environment, branch `task/<id>-<slug>` (`outcome_branch`), model by job (`docs/decisions.md` "Model by job, revised"): `claude-haiku-4-5-20251001` for code (build and fix), `claude-sonnet-5` for docs, CRUD and UI. The brief states, in this order:

1. "Run at medium effort." The module and its critical-path priority `[cp N]`.
2. The job in at most four numbered steps.
3. "Read first, only these": `CLAUDE.md` (automatic), the module card `docs/design/modules/<module>.md`, `docs/design/modules/_rules.md`, `docs/session-conventions.md`, and the READMEs of the modules it depends on. Everything else as slices.
4. Reporting: open the PR; fire the relay `trig_01FPLnjfTATPb7YQivWvA7FX` with "PR #n: <title>; migrations: <files>; [cp N]"; fire the coordinator `trig_01SpUT9nZPtAH1FBGiQaCiwu` with "<module>: PR #n opened"; subscribe to its own PR only; questions to `docs/questions/<module>.md`.
5. The 150k line: over it with work left, fire the coordinator with "<session> at <tokens>: hand-off needed" and stop.
6. No model identifiers in commits or PRs; the non-negotiables in `CLAUDE.md` apply.

Record the session in state (open PRs or sessions without a PR). A session a Routine run creates is lineage depth 1, so the depth limit no longer bites.

## Owner rules for the coordinator

- Accept, confirm and go ahead. Ask the owner only for accounts, secrets, payments and prices; never ask for a secret in chat.
- The current goal is milestone L (`docs/backlog.md`): the whole app running locally on the owner's PC for one user. photo-review stays parked.
- Apply every merged migration, module or gateway soon after the merge; the reviewer never touches Supabase.
- The owner sets the model of this Routine, the relay and the watchdog in the app (claude.ai/code/routines); a session never changes a Routine's model.

## The other Routines

- **Relay** `trig_01FPLnjfTATPb7YQivWvA7FX` (fresh session per fire): step 1 fires the reviewer's inbox; step 2 (fallback) fires this Routine.
- **Watchdog** `trig_011fjd2grZBEWR3FqfDzTWJR` (hourly, minute 34): step 3 wakes the reviewer; step 4 fires this Routine when no Routine named with "coordinator" and "sweep" has a future run (this one always has, by its cron) or the reviewer cannot be woken.
- **Old coordinator inboxes** (coordinators 11 to 17) forward, hop by hop, to this Routine; no session prompt needs them any more, except reviewer 14's inbox, which still names coordinator 14's. Name this Routine directly at the next reviewer hand-off.
