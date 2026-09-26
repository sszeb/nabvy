CREATE SCHEMA "suspected_labels";
--> statement-breakpoint
CREATE TABLE "suspected_labels"."approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"evidence_codes" text[],
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_id" uuid
);
--> statement-breakpoint
CREATE TABLE "suspected_labels"."candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"label_type" text NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"would_show" boolean DEFAULT false NOT NULL,
	"held_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suspected_labels"."correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"label_id" uuid NOT NULL,
	"requester_kind" text NOT NULL,
	"requester_user_id" uuid,
	"contact_email" text,
	"reason" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"internal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suspected_labels"."evaluations" (
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"card_hash" text,
	"inputs_hash" text,
	"rule_version" text NOT NULL,
	"signals" jsonb,
	"paths_met" text[],
	"t1_fetched_at" timestamp with time zone,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_source_source_listing_id_evidence_hash_rule_version_pk" PRIMARY KEY("source","source_listing_id","evidence_hash","rule_version")
);
--> statement-breakpoint
CREATE TABLE "suspected_labels"."labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"label_type" text NOT NULL,
	"candidate_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"shown_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_reason" text
);
--> statement-breakpoint
CREATE TABLE "suspected_labels"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"reviewer" text NOT NULL,
	"label" text,
	"sample" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suspected_labels"."rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label_type" text NOT NULL,
	"rule_id" text NOT NULL,
	"version" text NOT NULL,
	"thresholds" jsonb NOT NULL,
	"mode" text DEFAULT 'shadow' NOT NULL,
	"changed_by" text,
	"audit_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_label_type_rule_id_version" UNIQUE("label_type","rule_id","version")
);
--> statement-breakpoint
CREATE INDEX "idx_approvals_candidate" ON "suspected_labels"."approvals" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "idx_approvals_by" ON "suspected_labels"."approvals" USING btree ("by");--> statement-breakpoint
CREATE INDEX "idx_candidates_source_listing" ON "suspected_labels"."candidates" USING btree ("source","source_listing_id");--> statement-breakpoint
CREATE INDEX "idx_candidates_label_type" ON "suspected_labels"."candidates" USING btree ("label_type");--> statement-breakpoint
CREATE INDEX "idx_candidates_would_show" ON "suspected_labels"."candidates" USING btree ("would_show");--> statement-breakpoint
CREATE INDEX "idx_candidates_created_at" ON "suspected_labels"."candidates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_correction_requests_source_listing" ON "suspected_labels"."correction_requests" USING btree ("source","source_listing_id");--> statement-breakpoint
CREATE INDEX "idx_correction_requests_status" ON "suspected_labels"."correction_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_correction_requests_created_at" ON "suspected_labels"."correction_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_evaluations_done_at" ON "suspected_labels"."evaluations" USING btree ("done_at");--> statement-breakpoint
CREATE INDEX "idx_labels_source_listing" ON "suspected_labels"."labels" USING btree ("source","source_listing_id");--> statement-breakpoint
CREATE INDEX "idx_labels_label_type" ON "suspected_labels"."labels" USING btree ("label_type");--> statement-breakpoint
CREATE INDEX "idx_labels_shown_at" ON "suspected_labels"."labels" USING btree ("shown_at");--> statement-breakpoint
CREATE INDEX "idx_reviews_source_listing" ON "suspected_labels"."reviews" USING btree ("source","source_listing_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_reviewer" ON "suspected_labels"."reviews" USING btree ("reviewer");--> statement-breakpoint
CREATE INDEX "idx_reviews_at" ON "suspected_labels"."reviews" USING btree ("at");--> statement-breakpoint
CREATE INDEX "idx_rules_label_type" ON "suspected_labels"."rules" USING btree ("label_type");--> statement-breakpoint
CREATE INDEX "idx_rules_mode" ON "suspected_labels"."rules" USING btree ("mode");