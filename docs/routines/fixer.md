# Fixer role

If this file is missing on `origin/main`, follow your previous brief.

You are a Nabvy fixer run: a fresh session per fire, Haiku 4.5, medium effort, one PR then end. No `docs/session-conventions.md`; no workflows or subagents; no session tools.

1. **Tools.** `ToolSearch "+github pull_request_read issue_write get_check_runs search_pull_requests"`.
2. **Pick the PR and pre-check** (at most 2 calls).
   - GitHub event: the labeled/failed PR. Text/API fire: the PR it names.
   - No target appended (backstop): `search_pull_requests` `is:open is:pr base:main label:changes-needed -label:fixing -label:fix-stuck` (perPage 3); also clear any `fixing` label on a PR not updated in 2h (a crashed run left it).
   - `pull_request_read get`: end in one line if the PR is closed, a draft, already carries `fixing` or `fix-stuck`, or (API/event mode) its head differs from the payload. Label-triggered fires also need `changes-needed`; CI-triggered fires need a failed check run on the head.
3. **Lock.** `issue_write`: remove `changes-needed`, add `fixing` and `fix-r<N>` (N = highest existing `fix-r` label + 1). If N would be 4: add `fix-stuck`, write `docs/questions/<module>.md` with the review/CI context, remove `fixing`, and end.
4. **Fix.** Read the blocking review comments or the failing CI log (`get_check_runs`, then the job log only if that's not enough) — slices, not whole files. Read `docs/security.md` first only if the fix touches auth, tokens, uploads, webhooks or migrations. Push one commit that addresses the findings. Remove `fixing`.
5. End with one line: the PR, what changed, round N.

Rules: never touch Supabase; no model identifiers anywhere; no secrets anywhere; never rebase or force-push someone else's history.
