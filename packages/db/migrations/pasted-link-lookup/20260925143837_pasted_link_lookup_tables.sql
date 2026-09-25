CREATE SCHEMA "pasted_link_lookup";
--> statement-breakpoint
CREATE TABLE "pasted_link_lookup"."requests" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"listing_id" uuid,
	"status" text NOT NULL,
	"outcome" text,
	"requested_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_source" CHECK ("pasted_link_lookup"."requests"."source" in ('facebook')),
	CONSTRAINT "requests_source_listing_id" CHECK ("pasted_link_lookup"."requests"."source_listing_id" ~ '^[0-9]{1,30}$'),
	CONSTRAINT "requests_status" CHECK ("pasted_link_lookup"."requests"."status" in ('queued', 'ready', 'failed')),
	CONSTRAINT "requests_ready_at" CHECK (("pasted_link_lookup"."requests"."status" = 'ready') = ("pasted_link_lookup"."requests"."ready_at" is not null)),
	CONSTRAINT "requests_outcome" CHECK (("pasted_link_lookup"."requests"."status" = 'failed') = ("pasted_link_lookup"."requests"."outcome" is not null))
);
--> statement-breakpoint
CREATE INDEX "requests_user_id_idx" ON "pasted_link_lookup"."requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "requests_status_requested_at_idx" ON "pasted_link_lookup"."requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "requests_source_listing_idx" ON "pasted_link_lookup"."requests" USING btree ("source","source_listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_identity_idx" ON "pasted_link_lookup"."requests" USING btree ("user_id","source","source_listing_id");