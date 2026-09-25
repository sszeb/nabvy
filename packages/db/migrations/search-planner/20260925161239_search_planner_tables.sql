CREATE SCHEMA "search_planner";
--> statement-breakpoint
CREATE TABLE "search_planner"."one_off_runs" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"purpose" text NOT NULL,
	"input" jsonb NOT NULL,
	"centre_id" text,
	"approved_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_off_runs_purpose" CHECK ("search_planner"."one_off_runs"."purpose" in ('verification', 'gap-fill', 'actor-test', 'fixture')),
	CONSTRAINT "one_off_runs_status" CHECK ("search_planner"."one_off_runs"."status" in ('pending', 'submitted', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "one_off_runs_approved" CHECK ("search_planner"."one_off_runs"."purpose" = 'verification' or "search_planner"."one_off_runs"."approved_by" is not null),
	CONSTRAINT "one_off_runs_verification_centre" CHECK ("search_planner"."one_off_runs"."purpose" <> 'verification' or "search_planner"."one_off_runs"."centre_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "search_planner"."plan_terms" (
	"centre_id" text NOT NULL,
	"term" text NOT NULL,
	"origin" text NOT NULL,
	"class" text NOT NULL,
	"want_count" integer DEFAULT 0 NOT NULL,
	"paid_want_count" integer DEFAULT 0 NOT NULL,
	"in_budget" boolean DEFAULT false NOT NULL,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_terms_centre_id_term_origin_pk" PRIMARY KEY("centre_id","term","origin"),
	CONSTRAINT "plan_terms_class" CHECK ("search_planner"."plan_terms"."class" in ('narrow', 'broad')),
	CONSTRAINT "plan_terms_origin" CHECK ("search_planner"."plan_terms"."origin" in ('wants', 'pivot', 'admin-test')),
	CONSTRAINT "plan_terms_term" CHECK ("search_planner"."plan_terms"."term" ~ '^[a-z0-9][a-z0-9 .+-]*$' and char_length("search_planner"."plan_terms"."term") <= 100),
	CONSTRAINT "plan_terms_counts" CHECK ("search_planner"."plan_terms"."want_count" >= 0 and "search_planner"."plan_terms"."paid_want_count" >= 0 and "search_planner"."plan_terms"."paid_want_count" <= "search_planner"."plan_terms"."want_count"),
	CONSTRAINT "plan_terms_rank" CHECK (("search_planner"."plan_terms"."in_budget" and "search_planner"."plan_terms"."rank" >= 1) or (not "search_planner"."plan_terms"."in_budget" and "search_planner"."plan_terms"."rank" is null))
);
--> statement-breakpoint
CREATE TABLE "search_planner"."plans" (
	"centre_id" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "one_off_runs_live_verification_idx" ON "search_planner"."one_off_runs" USING btree ("centre_id") WHERE "search_planner"."one_off_runs"."purpose" = 'verification' and "search_planner"."one_off_runs"."status" in ('pending', 'submitted', 'completed');--> statement-breakpoint
CREATE INDEX "one_off_runs_status_idx" ON "search_planner"."one_off_runs" USING btree ("status","created_at");