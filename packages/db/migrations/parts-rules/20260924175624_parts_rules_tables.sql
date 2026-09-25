CREATE SCHEMA "parts_rules";
--> statement-breakpoint
CREATE TABLE "parts_rules"."rule_parts" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"seq" integer NOT NULL,
	"part_type" text NOT NULL,
	"catalogue_id" text,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inclusion_candidate" text NOT NULL,
	"source" text NOT NULL,
	"quote" text NOT NULL,
	"quote_start" integer NOT NULL,
	"quote_end" integer NOT NULL,
	"rule_id" text NOT NULL,
	"correction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_parts_run_seq_key" UNIQUE("listing_id","evidence_hash","rule_version","seq"),
	CONSTRAINT "rule_parts_part_type_check" CHECK ("parts_rules"."rule_parts"."part_type" in ('gpu', 'cpu', 'ram_size', 'ram_generation', 'storage_size', 'storage_type', 'psu_wattage', 'chipset')),
	CONSTRAINT "rule_parts_inclusion_check" CHECK ("parts_rules"."rule_parts"."inclusion_candidate" in ('offered', 'mention', 'not_included')),
	CONSTRAINT "rule_parts_source_check" CHECK ("parts_rules"."rule_parts"."source" in ('title', 'description', 'attribute')),
	CONSTRAINT "rule_parts_position_check" CHECK ("parts_rules"."rule_parts"."quote_start" >= 0 and "parts_rules"."rule_parts"."quote_end" > "parts_rules"."rule_parts"."quote_start"),
	CONSTRAINT "rule_parts_seq_check" CHECK ("parts_rules"."rule_parts"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "parts_rules"."runs" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"kind" text,
	"kind_gap" text,
	"kind_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tag_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"full_verified" boolean NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_listing_hash_version_key" UNIQUE("listing_id","evidence_hash","rule_version"),
	CONSTRAINT "runs_hash_check" CHECK ("parts_rules"."runs"."evidence_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "runs_version_check" CHECK ("parts_rules"."runs"."rule_version" ~ '^r[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "runs_kind_check" CHECK ("parts_rules"."runs"."kind" in ('wanted_or_swap', 'laptop', 'pc', 'not_a_pc')),
	CONSTRAINT "runs_kind_gap_check" CHECK ("parts_rules"."runs"."kind_gap" in ('no_signal', 'conflict')),
	CONSTRAINT "runs_kind_or_gap_check" CHECK (("parts_rules"."runs"."kind" is null) = ("parts_rules"."runs"."kind_gap" is not null))
);
--> statement-breakpoint
CREATE INDEX "rule_parts_catalogue_idx" ON "parts_rules"."rule_parts" USING btree ("catalogue_id");