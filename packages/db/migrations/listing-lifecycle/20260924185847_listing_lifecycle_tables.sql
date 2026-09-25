CREATE SCHEMA "listing_lifecycle";
--> statement-breakpoint
CREATE TABLE "listing_lifecycle"."rechecks" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"reason" text NOT NULL,
	"step" smallint NOT NULL,
	"requested_by" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rechecks_source_check" CHECK ("listing_lifecycle"."rechecks"."source" in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')),
	CONSTRAINT "rechecks_reason_check" CHECK ("listing_lifecycle"."rechecks"."reason" in ('alerted', 'candidate', 'watched', 'not-seen')),
	CONSTRAINT "rechecks_step_check" CHECK ("listing_lifecycle"."rechecks"."step" between 0 and 4),
	CONSTRAINT "rechecks_requested_by_check" CHECK ("listing_lifecycle"."rechecks"."requested_by" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
	CONSTRAINT "rechecks_outcome_check" CHECK ("listing_lifecycle"."rechecks"."outcome" in ('queued', 'skipped-unresolved')),
	CONSTRAINT "rechecks_sent_check" CHECK (("listing_lifecycle"."rechecks"."sent_at" is null) = ("listing_lifecycle"."rechecks"."outcome" is null))
);
--> statement-breakpoint
CREATE TABLE "listing_lifecycle"."status" (
	"listing_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"status" text NOT NULL,
	"basis" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"missed_sweeps" integer DEFAULT 0 NOT NULL,
	"input_hash" text NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_pkey" PRIMARY KEY("listing_id"),
	CONSTRAINT "status_source_check" CHECK ("listing_lifecycle"."status"."source" in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')),
	CONSTRAINT "status_status_check" CHECK ("listing_lifecycle"."status"."status" in ('live', 'pending', 'marked-sold', 'unresolved', 'not-seen-recently', 'unknown')),
	CONSTRAINT "status_basis_check" CHECK ("listing_lifecycle"."status"."basis" in ('search-card', 'detail', 'unresolved-fetch', 'missed-sweeps', 'no-data')),
	CONSTRAINT "status_missed_sweeps_check" CHECK ("listing_lifecycle"."status"."missed_sweeps" >= 0),
	CONSTRAINT "status_input_hash_check" CHECK ("listing_lifecycle"."status"."input_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "status_changed_by_check" CHECK (char_length("listing_lifecycle"."status"."changed_by") between 1 and 512)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rechecks_pending_key" ON "listing_lifecycle"."rechecks" USING btree ("listing_id","reason","step") WHERE "listing_lifecycle"."rechecks"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "rechecks_due_idx" ON "listing_lifecycle"."rechecks" USING btree ("due_at") WHERE "listing_lifecycle"."rechecks"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "rechecks_listing_idx" ON "listing_lifecycle"."rechecks" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "status_source_listing_key" ON "listing_lifecycle"."status" USING btree ("source","source_listing_id");--> statement-breakpoint
CREATE INDEX "status_status_idx" ON "listing_lifecycle"."status" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "status_changed_by_idx" ON "listing_lifecycle"."status" USING btree ("changed_by");