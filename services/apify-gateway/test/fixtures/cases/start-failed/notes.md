# A run whose start failed (synthetic)

Built from the Edge Function: when starting a run throws (for example Apify refuses it), the job
is marked `failed` with the error, no Apify run ID and no result
(`supabase/functions/apify-gateway/index.ts`, `finish(..., 'failed', null, message)`). Nothing ran,
so nothing is metered, collected or announced; the caller sees the failure in `v_jobs`.
