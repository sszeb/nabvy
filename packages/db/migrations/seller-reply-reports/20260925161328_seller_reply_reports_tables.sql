CREATE SCHEMA "seller_reply_reports";
--> statement-breakpoint
CREATE TABLE "seller_reply_reports"."holds" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"source" text NOT NULL,
	"scope_key" text NOT NULL,
	"reason" text NOT NULL,
	"opened_at" timestamp (3) with time zone NOT NULL,
	"released_at" timestamp (3) with time zone,
	"released_by" uuid,
	"audit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holds_reason" CHECK ("seller_reply_reports"."holds"."reason" in ('burst', 'gem_burst', 'counter_report'))
);
--> statement-breakpoint
CREATE TABLE "seller_reply_reports"."listing_evidence" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"source" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"family" text NOT NULL,
	"scope" text NOT NULL,
	"persons" integer NOT NULL,
	"weight_sum" numeric(8, 2) NOT NULL,
	"counter_weight" numeric(8, 2) NOT NULL,
	"level" text NOT NULL,
	"place_id" text,
	"distance_band" text,
	"held" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"carried_from_relist" boolean DEFAULT false NOT NULL,
	"inputs_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"as_of" timestamp (3) with time zone NOT NULL,
	"t1_fetched_at" timestamp (3) with time zone,
	"done_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_evidence_family" CHECK (family in ('location', 'handover', 'payment', 'link', 'item')),
	CONSTRAINT "listing_evidence_scope" CHECK ("seller_reply_reports"."listing_evidence"."scope" in ('own', 'copy')),
	CONSTRAINT "listing_evidence_level" CHECK ("seller_reply_reports"."listing_evidence"."level" in ('none', 'single', 'multiple')),
	CONSTRAINT "listing_evidence_band" CHECK (distance_band is null or distance_band in ('lt_10', '10_25', '25_50', '50_100', '100_plus', 'unknown')),
	CONSTRAINT "listing_evidence_hold" CHECK (("seller_reply_reports"."listing_evidence"."held" and "seller_reply_reports"."listing_evidence"."hold_reason" in ('burst', 'gem_burst', 'counter_report')) or (not "seller_reply_reports"."listing_evidence"."held" and "seller_reply_reports"."listing_evidence"."hold_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "seller_reply_reports"."report_reasons" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"report_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"second_answer" text,
	"reported_place_id" text,
	"distance_band" text,
	"counts" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_reasons_reason" CHECK (reason in ('collection_elsewhere', 'postage_only', 'payment_first', 'link_or_fb_delivery', 'not_as_described', 'other', 'as_listed')),
	CONSTRAINT "report_reasons_band" CHECK (distance_band is null or distance_band in ('lt_10', '10_25', '25_50', '50_100', '100_plus', 'unknown')),
	CONSTRAINT "report_reasons_counts" CHECK ("seller_reply_reports"."report_reasons"."counts" is null or "seller_reply_reports"."report_reasons"."counts" in ('any_path', 'path_b_only', 'none')),
	CONSTRAINT "report_reasons_place" CHECK ("seller_reply_reports"."report_reasons"."reported_place_id" is null or "seller_reply_reports"."report_reasons"."reason" = 'collection_elsewhere')
);
--> statement-breakpoint
CREATE TABLE "seller_reply_reports"."reporter_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"upheld" integer DEFAULT 0 NOT NULL,
	"not_upheld" integer DEFAULT 0 NOT NULL,
	"voided" integer DEFAULT 0 NOT NULL,
	"last_report_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporter_stats_nonnegative" CHECK ("seller_reply_reports"."reporter_stats"."upheld" >= 0 and "seller_reply_reports"."reporter_stats"."not_upheld" >= 0 and "seller_reply_reports"."reporter_stats"."voided" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seller_reply_reports"."reports" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"source" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"card_hash" text,
	"evidence_hash" text,
	"open_via" text,
	"first_opened_at" timestamp (3) with time zone,
	"eligibility" text DEFAULT 'pending' NOT NULL,
	"weight_at_submit" numeric(3, 2),
	"weight" numeric(3, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'saved' NOT NULL,
	"outcome" text,
	"outcome_by" text,
	"listing_shipping_offered" boolean,
	"listing_checkout_enabled" boolean,
	"listing_messaging_enabled" boolean,
	"note_text" text,
	"tester" boolean DEFAULT false NOT NULL,
	"rule_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp (3) with time zone,
	CONSTRAINT "reports_eligibility" CHECK ("seller_reply_reports"."reports"."eligibility" in ('pending', 'eligible', 'no_open', 'too_soon', 'too_late', 'email_unverified', 'not_active', 'too_new', 'rate_limited', 'burst_hold', 'tester', 'messaging_off', 'noise', 'suppressed')),
	CONSTRAINT "reports_status" CHECK ("seller_reply_reports"."reports"."status" in ('saved', 'helping_warn', 'not_shown', 'removed_after_check', 'withdrawn')),
	CONSTRAINT "reports_outcome" CHECK ("seller_reply_reports"."reports"."outcome" is null or "seller_reply_reports"."reports"."outcome" in ('upheld', 'not_upheld', 'void', 'unknown')),
	CONSTRAINT "reports_outcome_by" CHECK ("seller_reply_reports"."reports"."outcome_by" is null or "seller_reply_reports"."reports"."outcome_by" in ('review', 'corroboration', 'correction', 'report_then_buy', 'ban')),
	CONSTRAINT "reports_weights" CHECK ("seller_reply_reports"."reports"."weight" between 0 and 1 and coalesce("seller_reply_reports"."reports"."weight_at_submit", 0) between 0 and 1),
	CONSTRAINT "reports_no_note" CHECK ("seller_reply_reports"."reports"."note_text" is null)
);
--> statement-breakpoint
CREATE TABLE "seller_reply_reports"."testers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"added_by" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"added_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_reply_reports"."report_reasons" ADD CONSTRAINT "report_reasons_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "seller_reply_reports"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holds_identity_idx" ON "seller_reply_reports"."holds" USING btree ("scope_key","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holds_open_idx" ON "seller_reply_reports"."holds" USING btree ("scope_key","reason") WHERE released_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_evidence_identity_idx" ON "seller_reply_reports"."listing_evidence" USING btree ("source","listing_id","family","scope","rule_version");--> statement-breakpoint
CREATE INDEX "listing_evidence_listing_idx" ON "seller_reply_reports"."listing_evidence" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_reasons_identity_idx" ON "seller_reply_reports"."report_reasons" USING btree ("report_id","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_identity_idx" ON "seller_reply_reports"."reports" USING btree ("listing_id","reporter_user_id");--> statement-breakpoint
CREATE INDEX "reports_reporter_idx" ON "seller_reply_reports"."reports" USING btree ("reporter_user_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_listing_idx" ON "seller_reply_reports"."reports" USING btree ("listing_id");