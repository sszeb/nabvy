CREATE SCHEMA "noise_filter";
--> statement-breakpoint
CREATE TABLE "noise_filter"."classifications" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"classified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classifications_version_key" UNIQUE("listing_id","evidence_hash","input_hash","rule_version"),
	CONSTRAINT "classifications_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "classifications_input_hash_check" CHECK (input_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "classifications_rule_version_check" CHECK (rule_version ~ '^n[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "classifications_reasons_check" CHECK (jsonb_typeof(reasons) = 'array' and '["wanted", "buy_in", "swap", "laptop", "box_only", "mention_only", "keyword_stuffing", "service"]'::jsonb @> reasons),
	CONSTRAINT "classifications_arrays_check" CHECK (jsonb_typeof("noise_filter"."classifications"."evidence") = 'array' and jsonb_typeof("noise_filter"."classifications"."terms") = 'array')
);
--> statement-breakpoint
CREATE INDEX "classifications_listing_classified_idx" ON "noise_filter"."classifications" USING btree ("listing_id","classified_at");