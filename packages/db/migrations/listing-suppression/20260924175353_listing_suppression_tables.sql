CREATE SCHEMA "listing_suppression";
--> statement-breakpoint
CREATE TABLE "listing_suppression"."entries" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"basis" text,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_request_value_key" UNIQUE("request_id","kind","value"),
	CONSTRAINT "entries_kind_check" CHECK ("listing_suppression"."entries"."kind" in ('listing_hash', 'seller_key', 'lookalike')),
	CONSTRAINT "entries_value_check" CHECK ("listing_suppression"."entries"."value" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "entries_lookalike_check" CHECK (("listing_suppression"."entries"."kind" = 'lookalike') = ("listing_suppression"."entries"."basis" is not null and "listing_suppression"."entries"."expires_at" is not null)),
	CONSTRAINT "entries_basis_check" CHECK ("listing_suppression"."entries"."basis" in ('description', 'card'))
);
--> statement-breakpoint
CREATE INDEX "entries_kind_value_idx" ON "listing_suppression"."entries" USING btree ("kind","value");