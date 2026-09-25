CREATE SCHEMA "listing_assessment";
--> statement-breakpoint
CREATE TABLE "listing_assessment"."assessments" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"card_hash" text,
	"record_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"form" text NOT NULL,
	"container" boolean NOT NULL,
	"container_reason" text NOT NULL,
	"gpu_state" text NOT NULL,
	"cautions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage" jsonb NOT NULL,
	"confirmed_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unknowns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"correction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_version_key" UNIQUE NULLS NOT DISTINCT("listing_id","evidence_hash","card_hash","record_hash","rule_version"),
	CONSTRAINT "assessments_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assessments_card_hash_check" CHECK (card_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assessments_record_hash_check" CHECK (record_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assessments_rule_version_check" CHECK (rule_version ~ '^a[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "assessments_form_check" CHECK (form in ('system', 'bundle', 'part', 'box_only', 'unknown')),
	CONSTRAINT "assessments_container_reason_check" CHECK (container_reason in ('parts', 'attributes', 'title_words', 'kind', 'unplaced', 'placed', 'box_only')),
	CONSTRAINT "assessments_container_check" CHECK (("listing_assessment"."assessments"."container_reason" in ('placed', 'box_only')) = (not "listing_assessment"."assessments"."container")),
	CONSTRAINT "assessments_gpu_state_check" CHECK (gpu_state in ('named', 'none', 'integrated', 'in_photos', 'not_stated', 'conflicting')),
	CONSTRAINT "assessments_arrays_check" CHECK (jsonb_typeof("listing_assessment"."assessments"."cautions") = 'array' and jsonb_typeof("listing_assessment"."assessments"."confirmed_parts") = 'array' and jsonb_typeof("listing_assessment"."assessments"."exclusions") = 'array' and jsonb_typeof("listing_assessment"."assessments"."extras") = 'array' and jsonb_typeof("listing_assessment"."assessments"."unknowns") = 'array'),
	CONSTRAINT "assessments_coverage_check" CHECK (jsonb_typeof("listing_assessment"."assessments"."coverage") = 'object')
);
--> statement-breakpoint
CREATE INDEX "assessments_listing_assessed_idx" ON "listing_assessment"."assessments" USING btree ("listing_id","evidence_hash","assessed_at");