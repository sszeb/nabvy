CREATE SCHEMA "details_selector";
--> statement-breakpoint
CREATE TABLE "details_selector"."selections" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"card_hash" text NOT NULL,
	"reason" text NOT NULL,
	"selected_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selections_source_listing_hash_key" UNIQUE("source","source_listing_id","card_hash"),
	CONSTRAINT "selections_source_check" CHECK ("details_selector"."selections"."source" in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')),
	CONSTRAINT "selections_reason_check" CHECK ("details_selector"."selections"."reason" in ('in_area', 'shipped')),
	CONSTRAINT "selections_card_hash_check" CHECK ("details_selector"."selections"."card_hash" ~ '^[0-9a-f]{64}$')
);
