CREATE SCHEMA "check_scheduler";
--> statement-breakpoint
CREATE TABLE "check_scheduler"."check_runs" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"job_id" integer,
	"centre_id" text NOT NULL,
	"kind" text NOT NULL,
	"shape" text NOT NULL,
	"terms" text[] NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"tick_at" timestamp with time zone,
	"rerun_of" uuid,
	"one_off_id" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_runs_kind" CHECK ("check_scheduler"."check_runs"."kind" in ('newest', 'catch-up', 'sweep')),
	CONSTRAINT "check_runs_shape" CHECK ("check_scheduler"."check_runs"."shape" in ('verification', 'newest-check', 'sweep-narrow', 'sweep-broad')),
	CONSTRAINT "check_runs_reason" CHECK ("check_scheduler"."check_runs"."reason" in ('scheduled', 'rerun', 'one-off', 'verification')),
	CONSTRAINT "check_runs_status" CHECK ("check_scheduler"."check_runs"."status" in ('pending', 'submitted', 'refused', 'shadow')),
	CONSTRAINT "check_runs_terms" CHECK (cardinality("check_scheduler"."check_runs"."terms") between 1 and 20 and array_position("check_scheduler"."check_runs"."terms", null) is null),
	CONSTRAINT "check_runs_job" CHECK (("check_scheduler"."check_runs"."status" = 'submitted') = ("check_scheduler"."check_runs"."job_id" is not null)),
	CONSTRAINT "check_runs_tick" CHECK (("check_scheduler"."check_runs"."status" = 'pending') = ("check_scheduler"."check_runs"."tick_at" is null)),
	CONSTRAINT "check_runs_rerun" CHECK (("check_scheduler"."check_runs"."reason" = 'rerun') = ("check_scheduler"."check_runs"."rerun_of" is not null)),
	CONSTRAINT "check_runs_one_off" CHECK (("check_scheduler"."check_runs"."reason" in ('one-off', 'verification')) = ("check_scheduler"."check_runs"."one_off_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "check_scheduler"."schedule" (
	"centre_id" text NOT NULL,
	"term_class" text NOT NULL,
	"kind" text NOT NULL,
	"cadence_s" integer NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_centre_id_term_class_kind_pk" PRIMARY KEY("centre_id","term_class","kind"),
	CONSTRAINT "schedule_kind" CHECK ("check_scheduler"."schedule"."kind" in ('newest', 'catch-up', 'sweep')),
	CONSTRAINT "schedule_term_class" CHECK ("check_scheduler"."schedule"."term_class" in ('narrow', 'broad')),
	CONSTRAINT "schedule_cadence" CHECK ("check_scheduler"."schedule"."cadence_s" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "check_runs_tick_centre_idx" ON "check_scheduler"."check_runs" USING btree ("tick_at","centre_id");--> statement-breakpoint
CREATE UNIQUE INDEX "check_runs_rerun_of_idx" ON "check_scheduler"."check_runs" USING btree ("rerun_of");--> statement-breakpoint
CREATE UNIQUE INDEX "check_runs_live_one_off_idx" ON "check_scheduler"."check_runs" USING btree ("one_off_id") WHERE "check_scheduler"."check_runs"."status" <> 'refused';--> statement-breakpoint
CREATE INDEX "check_runs_job_idx" ON "check_scheduler"."check_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "check_runs_centre_idx" ON "check_scheduler"."check_runs" USING btree ("centre_id","tick_at");--> statement-breakpoint
CREATE INDEX "schedule_due_idx" ON "check_scheduler"."schedule" USING btree ("next_due_at");