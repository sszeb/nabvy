CREATE SCHEMA "parts_ai";
--> statement-breakpoint
CREATE TABLE "parts_ai"."ai_parts" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"seq" integer NOT NULL,
	"part_type" text NOT NULL,
	"catalogue_id" text,
	"family" text,
	"inclusion" text NOT NULL,
	"source" text NOT NULL,
	"quote" text NOT NULL,
	"quote_start" integer NOT NULL,
	"quote_end" integer NOT NULL,
	"correction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_parts_call_seq_key" UNIQUE("listing_id","evidence_hash","prompt_version","seq"),
	CONSTRAINT "ai_parts_part_type_check" CHECK (part_type in ('gpu', 'cpu', 'ram_size', 'ram_generation', 'storage_size', 'storage_type', 'psu_wattage', 'chipset')),
	CONSTRAINT "ai_parts_inclusion_check" CHECK ("parts_ai"."ai_parts"."inclusion" in ('offered', 'mention', 'not_included')),
	CONSTRAINT "ai_parts_source_check" CHECK (source in ('title', 'description')),
	CONSTRAINT "ai_parts_position_check" CHECK ("parts_ai"."ai_parts"."quote_start" >= 0 and "parts_ai"."ai_parts"."quote_end" > "parts_ai"."ai_parts"."quote_start"),
	CONSTRAINT "ai_parts_seq_check" CHECK ("parts_ai"."ai_parts"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "parts_ai"."calls" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"trace_id" text NOT NULL,
	"cost_gbp_micros" bigint NOT NULL,
	"status" text NOT NULL,
	"kind" text,
	"kind_source" text,
	"kind_quote" text,
	"kind_start" integer,
	"kind_end" integer,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_listing_hash_version_key" UNIQUE("listing_id","evidence_hash","prompt_version"),
	CONSTRAINT "calls_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "calls_version_check" CHECK (prompt_version ~ '^p[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "calls_status_check" CHECK ("parts_ai"."calls"."status" in ('extracted', 'quarantined')),
	CONSTRAINT "calls_cost_check" CHECK ("parts_ai"."calls"."cost_gbp_micros" >= 0),
	CONSTRAINT "calls_kind_check" CHECK (kind in ('wanted_or_swap', 'laptop', 'pc', 'not_a_pc')),
	CONSTRAINT "calls_kind_source_check" CHECK (kind_source in ('title', 'description')),
	CONSTRAINT "calls_kind_complete_check" CHECK (("parts_ai"."calls"."kind" is null and "parts_ai"."calls"."kind_source" is null and "parts_ai"."calls"."kind_quote" is null and "parts_ai"."calls"."kind_start" is null and "parts_ai"."calls"."kind_end" is null) or ("parts_ai"."calls"."kind" is not null and "parts_ai"."calls"."kind_source" is not null and "parts_ai"."calls"."kind_quote" is not null and "parts_ai"."calls"."kind_start" >= 0 and "parts_ai"."calls"."kind_end" > "parts_ai"."calls"."kind_start" and "parts_ai"."calls"."status" = 'extracted'))
);
--> statement-breakpoint
CREATE TABLE "parts_ai"."quarantine" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"problem" text NOT NULL,
	"detail" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quarantine_listing_hash_version_key" UNIQUE("listing_id","evidence_hash","prompt_version"),
	CONSTRAINT "quarantine_problem_check" CHECK ("parts_ai"."quarantine"."problem" in ('invalid_output', 'quote_not_found')),
	CONSTRAINT "quarantine_detail_check" CHECK (length("parts_ai"."quarantine"."detail") <= 500)
);
--> statement-breakpoint
CREATE TABLE "parts_ai"."refreshes" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refreshes_listing_hash_key" UNIQUE("listing_id","evidence_hash"),
	CONSTRAINT "refreshes_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "ai_parts_catalogue_idx" ON "parts_ai"."ai_parts" USING btree ("catalogue_id");--> statement-breakpoint
CREATE INDEX "calls_done_at_idx" ON "parts_ai"."calls" USING btree ("done_at");