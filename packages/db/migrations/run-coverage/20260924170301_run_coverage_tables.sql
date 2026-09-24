CREATE SCHEMA "run_coverage";
--> statement-breakpoint
CREATE TABLE "run_coverage"."scope_baselines" (
	"centre_id" text NOT NULL,
	"term" text NOT NULL,
	"kind" text NOT NULL,
	"basis" text NOT NULL,
	"first_complete_at" timestamp with time zone NOT NULL,
	"job_id" integer NOT NULL,
	"search_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scope_baselines_pkey" PRIMARY KEY("centre_id","term","kind"),
	CONSTRAINT "scope_baselines_kind_check" CHECK ("run_coverage"."scope_baselines"."kind" in ('newest', 'sweep')),
	CONSTRAINT "scope_baselines_basis_check" CHECK ("run_coverage"."scope_baselines"."basis" in ('complete', 'bounded'))
);
--> statement-breakpoint
CREATE TABLE "run_coverage"."search_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"job_id" integer NOT NULL,
	"search_index" integer NOT NULL,
	"centre_id" text,
	"term" text,
	"kind" text NOT NULL,
	"route" text NOT NULL,
	"stop_reason" text NOT NULL,
	"reported_route" text,
	"reported_stop_reason" text,
	"pages" integer,
	"listings" integer NOT NULL,
	"feed_type" text,
	"binding" text,
	"page_one_overlap" integer,
	"previous_job_id" integer,
	"status" text NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"control_latitude" double precision,
	"control_longitude" double precision,
	"control_radius_km" double precision,
	"control_sort" text,
	"collected_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_outcomes_job_search_key" UNIQUE("job_id","search_index"),
	CONSTRAINT "search_outcomes_kind_check" CHECK ("run_coverage"."search_outcomes"."kind" in ('newest', 'sweep', 'unknown')),
	CONSTRAINT "search_outcomes_route_check" CHECK ("run_coverage"."search_outcomes"."route" in ('http', 'browser-fallback', 'failed', 'unknown')),
	CONSTRAINT "search_outcomes_stop_reason_check" CHECK ("run_coverage"."search_outcomes"."stop_reason" in ('source-no-new-listings', 'page-cap', 'results-limit', 'time-limit', 'unknown')),
	CONSTRAINT "search_outcomes_status_check" CHECK ("run_coverage"."search_outcomes"."status" in ('complete', 'capped', 'degraded')),
	CONSTRAINT "search_outcomes_feed_type_check" CHECK ("run_coverage"."search_outcomes"."feed_type" in ('short', 'long')),
	CONSTRAINT "search_outcomes_counts_check" CHECK ("run_coverage"."search_outcomes"."search_index" >= 0 and "run_coverage"."search_outcomes"."listings" >= 0 and "run_coverage"."search_outcomes"."pages" >= 0 and "run_coverage"."search_outcomes"."page_one_overlap" >= 0)
);
--> statement-breakpoint
CREATE INDEX "search_outcomes_scope_idx" ON "run_coverage"."search_outcomes" USING btree ("centre_id","term","kind","collected_at");