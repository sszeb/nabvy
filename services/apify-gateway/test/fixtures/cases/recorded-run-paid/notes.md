# Recorded run as a paid run, from `submitRun` to `run-settled`

The same run as a job `check-scheduler` would submit: its exact input and run options
(`input.json`: 1,024 MB, 300 s, `maxRequests` 60).

- Reservation **$0.3363**: 1 GB × 300 s at $0.40 per compute unit, plus 60 requests × 0.5 MB at
  $10/GB, plus $0.01 (the gateway's formula; `run.json` `reserveUsd`, and the gateway SQL test).
- The watcher records the reservation in cost-meter once the run has an Apify run ID
  (336,300 micros), announces `run-collected` once the rows are stored, and settles once the
  gateway has read the final cost 10 minutes after the finish: **$0.0177**
  (`run.json` `settledCostUsd`; the reading at finish was $0.0003, `run.usageTotalUsd`).
- `run-settled` follows the settlement, once. The second tick writes and publishes nothing.
