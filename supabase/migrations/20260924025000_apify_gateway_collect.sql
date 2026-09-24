-- Lossless collection (owner's decision, 2026-09-24: keep all data the actor returns).
--   * A new free job kind, `collect`, re-downloads a finished run's dataset and RUN_SUMMARY into
--     its own rows (input: {"apifyRunId": "..."}). It recovers a run whose collection failed and
--     verifies the download path. It never counts towards spend: the run is already paid for.
--   * The dataset is downloaded in pages of `settings.download_page_size` rows until the last page,
--     so no row is ever left behind (the first gateway version stopped at 1,000 rows).

alter table apify_gateway.jobs drop constraint jobs_kind_check;
alter table apify_gateway.jobs
  add constraint jobs_kind_check check (kind in ('env_check', 'actor_info', 'run', 'collect'));

alter table apify_gateway.settings
  add column download_page_size integer not null default 1000
  check (download_page_size between 1 and 1000);
