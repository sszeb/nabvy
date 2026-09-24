# Session conventions

Coordinator-proposed conventions under `CLAUDE.md`, "Working economy"; not owner rules. Where they differ, `CLAUDE.md` wins. Build briefs point here instead of restating the rules, so the wording cannot drift between briefs.

- **Finding the reviewer.** Use the session ID in your brief or in `docs/handoff.md`, with `get_session`. Never look it up by tag: the `list_sessions` tag filter errors inside a session.
- **Before pushing.** Run `pnpm install --frozen-lockfile --prefer-offline`, then `pnpm lint && pnpm typecheck && pnpm test` without `-s`. A fresh container has no `node_modules`, and a silenced missing tool looks like a pass. Any non-zero exit is a failure.
- **Pull request events.** On `subscription.created`, end the turn with no tool calls. On the first CI failure for a head commit, read every failed job's log in one step and fix all of them in one push. Later events for the same commit need no tool calls.
- **Check-ins.** A check-in's first call reads your pull requests' state with a `fields` filter. If all are merged or closed, stop and do not re-arm. Keep no check-in while you wait only on the owner. A fallback check-in is no more often than hourly.
- **Hand-off.** At the start of a wake that brings new work, call `get_session` on yourself; over 300,000 used tokens, hand off before starting it.
- **Names.** Name tools by bare name (`execute_sql`, `get_session`), never with the connector prefix, which can change mid-session. Record model tiers as "top" or "Sonnet", never as model IDs.
- **Local migration dry-run.** `pnpm db:dry-run` needs the Postgres extensions: `apt-get install postgresql-16-pgvector postgresql-16-postgis-3`.
- **Notes for the coordinator.** Send them to the coordinator session named at the top of `docs/handoff.md` (coordinator 5 is `session_01MarM2efLcMPfNeb48TbGoM`), never to a session that has handed off.
- **Reviews look like your own.** The reviewer posts from the same GitHub account as build sessions. Never skip a `pull_request_review.submitted` event as an echo: read its verdict line, and treat "Changes needed" as work now.
- **Questions from a build session.** Write them to `docs/questions/<module>.md` (same entry format as `docs/questions.md`), never to `docs/questions.md` itself: every module PR appending to that file re-conflicts every other open PR. The coordinator folds the per-module files into `docs/questions.md` at its batched pushes and deletes them. For the same reason a build session never edits `docs/progress.md` or `docs/backlog.md`; the coordinator records each pull request there (coordinator 5, 16:15).
