Run at medium effort. Module: price-drop-watch [cp 6]. You are the round-2 fix session for PR #70 (branch `task/w1-price-drop-watch`, head 7e42044). Push to that branch only; never rewrite its history (merge commits, no rebase or force-push).

Job:
1. Read review 5324943052 on PR #70 and the latest PR #70 comment (hand-off note and proposed fix from session_013TTwsCCZGwSmh4kpgXT2pr).
2. Blocking 1: in `services/price-drop-watch/src/index.ts` (~168-171) with `dedupeAnnouncements` in `src/domain/index.ts`, stop gating a watch's own newly inserted drop on the group's earliest watch also being new. Announce each newly inserted drop unless the same `(relistGroupId, toMinor)` was already announced (in this pass or an earlier one). Add a cross-pass relist-group fixture/test: watch A announced in pass 1; watch B joins the group later; pass 2 announces B's new drop, and a replay announces nothing.
3. Blocking 2: CI "Typecheck, lint and test" was cancelled by the 15-minute timeout. Merge `origin/main` into the branch (it may carry the faster CI); if CI still times out and #104 (scoped CI) is not merged, say so on the PR instead of editing CI yourself.
4. Run `pnpm typecheck && pnpm lint && pnpm test --filter @nabvy/price-drop-watch...` locally before pushing; one validated push.

Read first, only these: `CLAUDE.md` (automatic), `docs/design/modules/price-drop-watch.md`, `docs/design/modules/_rules.md`, `docs/session-conventions.md`, `services/price-drop-watch/README.md`. Everything else as slices.

Reporting: reply on the review, then fire the reviewer `trig_01FPLnjfTATPb7YQivWvA7FX` with "PR #70: price-drop-watch round 2 fixes; migrations: unchanged; [cp 6]". Subscribe to PR #70 only. Questions to `docs/questions/price-drop-watch.md`.

Over 150k tokens with work left: fire the coordinator `trig_01SpUT9nZPtAH1FBGiQaCiwu` with "<session> at <tokens>: hand-off needed" and stop.

No model identifiers in commits or PRs; the non-negotiables in `CLAUDE.md` apply.
