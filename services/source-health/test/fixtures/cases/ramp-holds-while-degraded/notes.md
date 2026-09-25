Two days at 40% degraded: the share did not rise, so the round-1 rule (rise only) would have
advanced the stage while Facebook was serving fallbacks on four searches in ten. Yesterday's share
is above `SOURCE_HEALTH_ALERT_PCT_DEGRADED` (10%, the case's `alertPctDegraded`), so
`decideRampAdvance` refuses with `degraded`. `alerted` is empty here on purpose, so this case
exercises the threshold check itself, not the alert check (`ramp-holds-after-alert`). Review of
PR #63 head 3d8b32e, blocking finding 3.
