-- Round 2 of PR #63 (review of head 3d8b32e, blocking findings 1, 2 and non-blocking 8). Appended
-- rather than editing the two files before it (packages/db/README.md). Hand-written per "Adding
-- tables to a module": pipeline-only grants, no user rows, no RLS.
--
-- 1. `processed_jobs`: one row per apify-gateway job ever folded into a day, keyed by the job ID
--    across days. The handler inserts here first with `on conflict do nothing`; only a real insert
--    goes on to add the job's counts to `health_daily` with SQL increments, so two jobs landing on
--    one day at once compose instead of one overwriting the other, and a redelivery after London
--    midnight (a different `day`) is still a no-op. `day` is the job's own Europe/London day from
--    apify-gateway's `v_jobs` (`settled_at`, else `finished_at`, else `created_at`), never the
--    delivery time.
-- 2. `health_daily.processed_job_ids` goes: it was the in-row bookkeeping this table replaces
--    (read-modify-write of a whole row, which lost updates between concurrent jobs). The module
--    had never run against a live database before this PR merged, so the column held no data.
-- 3. `ramp.stage` becomes unique: a stage is entered once, so two concurrent `assessRamp` calls
--    (or a seed racing an advance) cannot both insert the same stage; the repo inserts with
--    `on conflict do nothing` and treats "not inserted" as "someone else advanced first".

create table source_health.processed_jobs (
  job_id integer primary key,
  day text not null,
  processed_at timestamp with time zone default now() not null
);

alter table source_health.health_daily drop column processed_job_ids;

alter table source_health.ramp add constraint ramp_stage_unique unique (stage);

-- Append-only, like ramp: no update, no delete. Rows are never revised (a job is folded in once).
grant select, insert on source_health.processed_jobs to nabvy_pipeline;
