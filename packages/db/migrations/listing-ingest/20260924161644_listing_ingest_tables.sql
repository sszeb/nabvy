CREATE SCHEMA "listing_ingest";
--> statement-breakpoint
CREATE TABLE "listing_ingest"."listings" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"card_hash" text NOT NULL,
	"price_minor" bigint,
	"currency" text,
	"money_kind" text,
	"title" text NOT NULL,
	"listed_at" timestamp with time zone,
	"first_fetched_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"city_page_id" text,
	"town_label" text,
	"availability" text NOT NULL,
	"category_id" text,
	"delivery_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_photo_id" text,
	"displayed_previous_minor" bigint,
	"binding" text,
	"found_by_terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"item_job_id" integer NOT NULL,
	"item_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_source_listing_key" UNIQUE("source","source_listing_id"),
	CONSTRAINT "listings_source_check" CHECK ("listing_ingest"."listings"."source" in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')),
	CONSTRAINT "listings_currency_check" CHECK ("listing_ingest"."listings"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "listings_price_check" CHECK ("listing_ingest"."listings"."price_minor" >= 0 and "listing_ingest"."listings"."displayed_previous_minor" >= 0),
	CONSTRAINT "listings_availability_check" CHECK ("listing_ingest"."listings"."availability" in ('live', 'pending', 'sold', 'hidden', 'unknown')),
	CONSTRAINT "listings_card_hash_check" CHECK ("listing_ingest"."listings"."card_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "listing_ingest"."sightings" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"job_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"term" text,
	"centre_id" text,
	"rank" integer,
	"card_hash" text NOT NULL,
	"price_minor" bigint,
	"currency" text,
	"availability" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sightings_listing_job_kind_key" UNIQUE("listing_id","job_id","kind"),
	CONSTRAINT "sightings_kind_check" CHECK ("listing_ingest"."sightings"."kind" in ('search', 'detail')),
	CONSTRAINT "sightings_currency_check" CHECK ("listing_ingest"."sightings"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "sightings_price_check" CHECK ("listing_ingest"."sightings"."price_minor" >= 0),
	CONSTRAINT "sightings_rank_check" CHECK ("listing_ingest"."sightings"."rank" >= 1),
	CONSTRAINT "sightings_availability_check" CHECK ("listing_ingest"."sightings"."availability" in ('live', 'pending', 'sold', 'hidden', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "listing_ingest"."sightings" ADD CONSTRAINT "sightings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "listing_ingest"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_city_page_idx" ON "listing_ingest"."listings" USING btree ("city_page_id");--> statement-breakpoint
CREATE INDEX "sightings_listing_seen_idx" ON "listing_ingest"."sightings" USING btree ("listing_id","seen_at");--> statement-breakpoint
CREATE INDEX "sightings_job_idx" ON "listing_ingest"."sightings" USING btree ("job_id");