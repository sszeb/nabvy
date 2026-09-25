Yesterday is healthy (5%, no alert) but there is no row for the day before, so "do not rise"
cannot be judged at all. Round 1 passed `null` here and advanced; the rule now refuses with
`no-baseline` until two complete days exist (the same reason applies when yesterday itself has
no row). Review of PR #63 head 3d8b32e, blocking finding 3.
