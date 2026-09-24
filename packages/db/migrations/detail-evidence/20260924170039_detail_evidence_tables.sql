CREATE SCHEMA "detail_evidence";
--> statement-breakpoint
CREATE TABLE "detail_evidence"."evidence" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"item_job_id" integer NOT NULL,
	"item_seq" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"description_status" text,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detail_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_title" text,
	"custom_subtitles" text[] DEFAULT '{}'::text[] NOT NULL,
	"condition" text,
	"category_id" text,
	"category_path" text[] DEFAULT '{}'::text[] NOT NULL,
	"inventory_type" text,
	"lat" double precision,
	"lng" double precision,
	"gallery_total" integer,
	"gallery_complete" boolean,
	"photo_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"links_expire_at" timestamp with time zone,
	"detail_outcome" text,
	"stale_fallback" boolean DEFAULT false NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_listing_hash_key" UNIQUE("source","source_listing_id","evidence_hash"),
	CONSTRAINT "evidence_source_check" CHECK ("detail_evidence"."evidence"."source" in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')),
	CONSTRAINT "evidence_hash_check" CHECK ("detail_evidence"."evidence"."evidence_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evidence_description_status_check" CHECK ("detail_evidence"."evidence"."description_status" in ('full_verified', 'partial', 'missing')),
	CONSTRAINT "evidence_gallery_total_check" CHECK ("detail_evidence"."evidence"."gallery_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "detail_evidence"."fetches" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"listing_id" uuid,
	"job_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"detail_outcome" text,
	"detail_attempts" integer,
	"description_status" text,
	"cache_status" text,
	"stale_fallback" boolean DEFAULT false NOT NULL,
	"unresolved" boolean DEFAULT false NOT NULL,
	"evidence_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fetches_listing_job_key" UNIQUE("source","source_listing_id","job_id"),
	CONSTRAINT "fetches_source_check" CHECK ("detail_evidence"."fetches"."source" in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')),
	CONSTRAINT "fetches_hash_check" CHECK ("detail_evidence"."fetches"."evidence_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "fetches_description_status_check" CHECK ("detail_evidence"."fetches"."description_status" in ('full_verified', 'partial', 'missing')),
	CONSTRAINT "fetches_unresolved_check" CHECK (not ("detail_evidence"."fetches"."unresolved" and "detail_evidence"."fetches"."evidence_hash" is not null))
);
--> statement-breakpoint
CREATE INDEX "evidence_listing_idx" ON "detail_evidence"."evidence" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "fetches_listing_fetched_idx" ON "detail_evidence"."fetches" USING btree ("source","source_listing_id","fetched_at");--> statement-breakpoint
CREATE INDEX "fetches_job_idx" ON "detail_evidence"."fetches" USING btree ("job_id");