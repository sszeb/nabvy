CREATE SCHEMA "source_health";
--> statement-breakpoint
CREATE TABLE "source_health"."health_daily" (
	"day" text PRIMARY KEY NOT NULL,
	"processed_job_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_searches" integer DEFAULT 0 NOT NULL,
	"degraded_searches" integer DEFAULT 0 NOT NULL,
	"breaker_trips" integer DEFAULT 0 NOT NULL,
	"new_operation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seller_block_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alerted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_health"."ramp" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"stage" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"max_checks_per_day" integer NOT NULL,
	"advanced_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
