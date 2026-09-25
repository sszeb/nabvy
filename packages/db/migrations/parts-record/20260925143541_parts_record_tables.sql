CREATE SCHEMA "parts_record";
--> statement-breakpoint
CREATE TABLE "parts_record"."parts" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"seq" integer NOT NULL,
	"part_type" text NOT NULL,
	"catalogue_id" text,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inclusion" text NOT NULL,
	"source" text NOT NULL,
	"extractor" text NOT NULL,
	"extractor_version" text NOT NULL,
	"quote" text NOT NULL,
	"quote_start" integer NOT NULL,
	"quote_end" integer NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"correction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parts_record_seq_key" UNIQUE("record_id","seq"),
	CONSTRAINT "parts_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "parts_part_type_check" CHECK (part_type in ('gpu', 'cpu', 'ram_size', 'ram_generation', 'storage_size', 'storage_type', 'psu_wattage', 'chipset')),
	CONSTRAINT "parts_inclusion_check" CHECK (inclusion in ('offered', 'mention', 'not_included')),
	CONSTRAINT "parts_source_check" CHECK (source in ('title', 'description', 'attribute', 'photo')),
	CONSTRAINT "parts_extractor_check" CHECK (extractor in ('rules', 'ai', 'photo')),
	CONSTRAINT "parts_source_extractor_check" CHECK (("parts_record"."parts"."extractor" = 'photo') = ("parts_record"."parts"."source" = 'photo')),
	CONSTRAINT "parts_position_check" CHECK ("parts_record"."parts"."quote_start" >= 0 and "parts_record"."parts"."quote_end" > "parts_record"."parts"."quote_start"),
	CONSTRAINT "parts_seq_check" CHECK ("parts_record"."parts"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "parts_record"."records" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"ai_version" text,
	"photo_version" text,
	"kind" text,
	"kind_gap" text,
	"kind_by" text,
	"kind_source" text,
	"kind_quote" text,
	"kind_start" integer,
	"kind_end" integer,
	"part_count" integer NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "records_version_key" UNIQUE NULLS NOT DISTINCT("listing_id","evidence_hash","rule_version","ai_version","photo_version"),
	CONSTRAINT "records_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "records_rule_version_check" CHECK (rule_version ~ '^r[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "records_ai_version_check" CHECK (ai_version ~ '^p[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "records_photo_version_check" CHECK (photo_version ~ '^v[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "records_kind_check" CHECK (kind in ('wanted_or_swap', 'laptop', 'pc', 'not_a_pc')),
	CONSTRAINT "records_kind_gap_check" CHECK (kind_gap in ('no_signal', 'conflict')),
	CONSTRAINT "records_kind_by_check" CHECK (kind_by in ('rules', 'ai')),
	CONSTRAINT "records_kind_source_check" CHECK (kind_source in ('title', 'description', 'attribute', 'photo')),
	CONSTRAINT "records_part_count_check" CHECK ("parts_record"."records"."part_count" >= 0),
	CONSTRAINT "records_kind_complete_check" CHECK (("parts_record"."records"."kind" is null and "parts_record"."records"."kind_gap" is not null and "parts_record"."records"."kind_by" is null and "parts_record"."records"."kind_source" is null and "parts_record"."records"."kind_quote" is null and "parts_record"."records"."kind_start" is null and "parts_record"."records"."kind_end" is null) or ("parts_record"."records"."kind" is not null and "parts_record"."records"."kind_gap" is null and "parts_record"."records"."kind_by" is not null and (("parts_record"."records"."kind_quote" is null and "parts_record"."records"."kind_source" is null and "parts_record"."records"."kind_start" is null and "parts_record"."records"."kind_end" is null) or ("parts_record"."records"."kind_quote" is not null and "parts_record"."records"."kind_source" is not null and "parts_record"."records"."kind_start" >= 0 and "parts_record"."records"."kind_end" > "parts_record"."records"."kind_start"))))
);
--> statement-breakpoint
ALTER TABLE "parts_record"."parts" ADD CONSTRAINT "parts_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "parts_record"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parts_listing_idx" ON "parts_record"."parts" USING btree ("listing_id","evidence_hash");--> statement-breakpoint
CREATE INDEX "parts_catalogue_idx" ON "parts_record"."parts" USING btree ("catalogue_id");--> statement-breakpoint
CREATE INDEX "records_listing_recorded_idx" ON "parts_record"."records" USING btree ("listing_id","evidence_hash","recorded_at");