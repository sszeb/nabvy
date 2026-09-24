CREATE SCHEMA "details_queue";
--> statement-breakpoint
CREATE TABLE "details_queue"."items" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"lane" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"region_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requeues" integer DEFAULT 0 NOT NULL,
	"last_outcome" text,
	"job_id" integer,
	"deferred_on" date,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_source_listing_lane_key" UNIQUE("source","source_listing_id","lane"),
	CONSTRAINT "items_source_check" CHECK ("items"."source" in ('facebook')),
	CONSTRAINT "items_lane_check" CHECK ("items"."lane" in ('text', 'photo')),
	CONSTRAINT "items_priority_check" CHECK ("items"."priority" in ('new-listing', 'shortlisted', 'photo-capture', 'sweep')),
	CONSTRAINT "items_status_check" CHECK ("items"."status" in ('queued', 'leased', 'done', 'deferred', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "details_queue"."leases" (
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"job_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leases_pkey" PRIMARY KEY("source","source_listing_id")
);
--> statement-breakpoint
CREATE TABLE "details_queue"."batches" (
	"job_id" integer PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"lane" text NOT NULL,
	"region_id" text NOT NULL,
	"route" text NOT NULL,
	"size" integer NOT NULL,
	"source_listing_ids" text[] NOT NULL,
	"day" date NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"outcome" jsonb,
	CONSTRAINT "batches_size_check" CHECK ("batches"."size" between 1 and 200),
	CONSTRAINT "batches_route_check" CHECK ("batches"."route" in ('graphql', 'page'))
);
--> statement-breakpoint
CREATE INDEX "items_waiting_idx" ON "details_queue"."items" USING btree ("status","lane","region_id");
--> statement-breakpoint
CREATE INDEX "leases_job_idx" ON "details_queue"."leases" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX "batches_day_idx" ON "details_queue"."batches" USING btree ("day");
