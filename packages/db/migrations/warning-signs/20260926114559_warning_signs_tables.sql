CREATE SCHEMA "warning_signs";
--> statement-breakpoint
CREATE TABLE "warning_signs"."evaluations" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"card_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"fetched_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_version_key" UNIQUE("listing_id","evidence_hash","card_hash","input_hash","rule_version"),
	CONSTRAINT "evaluations_evidence_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evaluations_card_hash_check" CHECK (card_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evaluations_input_hash_check" CHECK (input_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evaluations_rule_version_check" CHECK (rule_version ~ '^w[0-9]+\.[0-9a-f]{8}$')
);
--> statement-breakpoint
CREATE TABLE "warning_signs"."facts" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"card_hash" text NOT NULL,
	"code" text NOT NULL,
	"reason" text,
	"evidence" jsonb NOT NULL,
	"evidence_text" text,
	"rule_id" text NOT NULL,
	"rule_version" text NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_evaluation_code_key" UNIQUE NULLS NOT DISTINCT("evaluation_id","code","reason"),
	CONSTRAINT "facts_code_check" CHECK (code in ('pay_first_text', 'platform_claim_text', 'away_story_text', 'off_platform_contact_text', 'urgency_text', 'thin_text', 'viewing_offered_text', 'payment_on_collection_text', 'protected_payment_text', 'box_only', 'mining_text', 'untested_text', 'not_working_text', 'stock_phrasing_text', 'ask_far_below_similar', 'low_ask_explained')),
	CONSTRAINT "facts_reason_check" CHECK ((code = 'low_ask_explained') = (reason is not null) and (reason is null or reason in ('not_working', 'for_parts', 'named_fault', 'box_only', 'core_part_missing', 'part_not_included', 'swap_or_trade', 'offers', 'cosmetic'))),
	CONSTRAINT "facts_evidence_check" CHECK (jsonb_typeof("warning_signs"."facts"."evidence") = 'object'),
	CONSTRAINT "facts_evidence_text_check" CHECK ("warning_signs"."facts"."evidence_text" is null or char_length("warning_signs"."facts"."evidence_text") between 1 and 200),
	CONSTRAINT "facts_rule_id_check" CHECK (rule_id ~ '^warning-signs\.[a-z_]+$'),
	CONSTRAINT "facts_rule_version_check" CHECK (rule_version ~ '^w[0-9]+\.[0-9a-f]{8}$')
);
--> statement-breakpoint
ALTER TABLE "warning_signs"."facts" ADD CONSTRAINT "facts_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "warning_signs"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluations_listing_evaluated_idx" ON "warning_signs"."evaluations" USING btree ("listing_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "facts_listing_idx" ON "warning_signs"."facts" USING btree ("listing_id");