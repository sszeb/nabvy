/**
 * Event delivery retries (docs/engineering.md, "Events and tasks"): 3 attempts with exponential
 * backoff starting at 5 s, then the dead-letter table in `incidents`. The fields are Trigger.dev's
 * task `retry` options, so a task file passes `eventRetry` unchanged. With `factor` 6 the waits are
 * 5 s then 30 s; the documented third wait (2 min) is the cap, since 3 attempts need only two
 * (docs/questions.md, 0.9).
 */
export const eventRetry = {
  maxAttempts: 3,
  minTimeoutInMs: 5_000,
  maxTimeoutInMs: 120_000,
  factor: 6,
  randomize: false,
} as const

/** Most envelopes in one Trigger.dev batch trigger call; larger publishes are split. */
export const publishBatchLimit = 500
