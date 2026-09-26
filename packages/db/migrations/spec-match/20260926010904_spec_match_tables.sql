CREATE SCHEMA "spec_match";
--> statement-breakpoint
CREATE TABLE "spec_match"."matches" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"want_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"card_hash" text,
	"input_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"verdict" text NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inside_pc" boolean NOT NULL,
	"origin" text NOT NULL,
	"backfill" boolean DEFAULT false NOT NULL,
	"matched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_input_key" UNIQUE("want_id","listing_id","input_hash","rule_version"),
	CONSTRAINT "matches_evidence_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "matches_card_hash_check" CHECK (card_hash is null or card_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "matches_input_hash_check" CHECK (input_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "matches_rule_version_check" CHECK (rule_version ~ '^s[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "matches_verdict_check" CHECK ("spec_match"."matches"."verdict" in ('match', 'no_match', 'not_stated')),
	CONSTRAINT "matches_origin_check" CHECK ("spec_match"."matches"."origin" in ('own_search', 'other_search')),
	CONSTRAINT "matches_criteria_check" CHECK (jsonb_typeof("spec_match"."matches"."criteria") = 'array')
);
--> statement-breakpoint
CREATE INDEX "matches_pair_matched_idx" ON "spec_match"."matches" USING btree ("want_id","listing_id","matched_at");--> statement-breakpoint
CREATE INDEX "matches_listing_idx" ON "spec_match"."matches" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "matches_user_idx" ON "spec_match"."matches" USING btree ("user_id");