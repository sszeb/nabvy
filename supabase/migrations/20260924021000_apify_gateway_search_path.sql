-- Pin the gateway functions' search_path (Supabase security advisor: function_search_path_mutable).
-- Every reference inside them is schema-qualified, and pg_catalog is always searched.
alter function apify_gateway.enqueue_run(jsonb, integer, integer, text) set search_path = '';
alter function apify_gateway.claim_next_job() set search_path = '';
alter function apify_gateway.invoke() set search_path = '';
