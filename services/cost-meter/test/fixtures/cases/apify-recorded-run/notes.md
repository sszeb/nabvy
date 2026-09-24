# apify-recorded-run

The first recorded run (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json`):
reserved at $0.3363 (`reserveUsd`, line 6), read at finish as $0.00029257 (`run.usageTotalUsd`,
line 14, "$0.0003") and settled at $0.0177 (`settledCostUsd`, line 5; `supabase/README.md`,
"Spend"). The reading at finish is taken at `finishedAt` itself, so it is refused as not final
and the reservation keeps counting; the reading 10 minutes later settles the run; a replay an
hour later writes nothing. The two later read times and the rate 0.75 are synthetic (the run
records neither the gateway's settle time nor `USD_GBP_RATE`).
