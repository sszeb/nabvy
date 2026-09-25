# Coordinator handoff

**There are no more coordinator hand-offs** (owner, 2026-09-25, 21:40; `docs/decisions.md` "Stateless coordinator"). The coordinator is the Routine `trig_01SpUT9nZPtAH1FBGiQaCiwu` "Nabvy coordinator (inbox and sweep)". Each time it fires it starts a fresh session. With a message appended, that session handles the message; on its two-hourly cron, it runs the sweep. Either way it reads only `state.md` on branch `claude/coordinator-state` and `docs/routines/coordinator.md`, writes `state.md` back and ends.

- **Current state** (IDs, open PRs, sessions, ledger, waiting on the owner): `git show origin/claude/coordinator-state:state.md`.
- **How a run works** (message kinds, sweep, migrations, briefs, token budget): `docs/routines/coordinator.md`.
- **History** (coordinators 1 to 17, 2026-09-24 and 2026-09-25): `docs/handoff-archive.md`. Read slices only, when state or a message points there.
- **Docs PR:** `claude/coordinator-16`, PR #101 into `main`. Only the sweep pushes to it.

Why (measured 2026-09-25): a long-lived coordinator re-reads its whole context on every call and has to hand off at 150k. Coordinators 15 to 17 each passed that line within minutes to hours, mostly on PR-subscription notices (8 KB each) and hand-off reading. Each hand-off also meant repointing the relay, the watchdog and every inbox. A fresh run per message stays at about 30k to 60k tokens and keeps one ID forever.
