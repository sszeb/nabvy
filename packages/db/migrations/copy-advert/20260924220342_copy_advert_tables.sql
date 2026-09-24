CREATE SCHEMA "copy_advert";
--> statement-breakpoint
CREATE TABLE "copy_advert"."account_checks" (
	"cluster_key" text NOT NULL,
	"run_id" text NOT NULL,
	"spans_accounts" boolean NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_checks_cluster_key_run_id_pk" PRIMARY KEY("cluster_key","run_id")
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."candidate_requests" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"advert_fp" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."clusters" (
	"cluster_key" text PRIMARY KEY NOT NULL,
	"rule_version" text NOT NULL,
	"member_set_hash" text NOT NULL,
	"price_minor" bigint,
	"currency" text,
	"listing_count" integer NOT NULL,
	"town_count" integer NOT NULL,
	"span_days" integer NOT NULL,
	"spread_km" real,
	"mass_posted" boolean NOT NULL,
	"status" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clusters_currency_check" CHECK ("copy_advert"."clusters"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "clusters_status_check" CHECK ("copy_advert"."clusters"."status" in ('active', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."flags" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"cluster_key" text NOT NULL,
	"towns" integer NOT NULL,
	"span_days" integer NOT NULL,
	"would_show" boolean NOT NULL,
	"corrected" text,
	"rule_version" text NOT NULL,
	"member_set_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flags_corrected_check" CHECK ("copy_advert"."flags"."corrected" in ('unflagged'))
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."links" (
	"listing_a" uuid NOT NULL,
	"listing_b" uuid NOT NULL,
	"basis" text NOT NULL,
	"similarity" real,
	"photo_id_match" boolean DEFAULT false NOT NULL,
	"rule_version" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_listing_a_listing_b_rule_version_pk" PRIMARY KEY("listing_a","listing_b","rule_version"),
	CONSTRAINT "links_order_check" CHECK ("copy_advert"."links"."listing_a" < "copy_advert"."links"."listing_b"),
	CONSTRAINT "links_basis_check" CHECK ("copy_advert"."links"."basis" in ('exact_text', 'near_text', 'candidate', 'lookalike', 'text_copy'))
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."members" (
	"cluster_key" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"source_listing_id" text NOT NULL,
	"city_page_id" text,
	"basis" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_cluster_key_listing_id_pk" PRIMARY KEY("cluster_key","listing_id")
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."overrides" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"listing_a" uuid,
	"listing_b" uuid,
	"reason" text NOT NULL,
	"audit_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overrides_kind_check" CHECK ("copy_advert"."overrides"."kind" in ('not_copy_pair', 'exclude_listing', 'confirm_pair'))
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."photo_matches" (
	"listing_a" uuid NOT NULL,
	"listing_b" uuid NOT NULL,
	"photo_id" text NOT NULL,
	"rule_version" text NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_matches_listing_a_listing_b_rule_version_pk" PRIMARY KEY("listing_a","listing_b","rule_version"),
	CONSTRAINT "photo_matches_order_check" CHECK ("copy_advert"."photo_matches"."listing_a" < "copy_advert"."photo_matches"."listing_b")
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."prints" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text NOT NULL,
	"card_hash" text NOT NULL,
	"evidence_hash" text DEFAULT '' NOT NULL,
	"rule_version" text NOT NULL,
	"title_norm" text NOT NULL,
	"price_minor" bigint,
	"currency" text,
	"advert_fp" text,
	"desc_status" text,
	"desc_norm" text,
	"desc_fp" text,
	"photo_id" text,
	"city_page_id" text,
	"listed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"input_t1" timestamp with time zone,
	"done_at" timestamp with time zone NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prints_version_key" UNIQUE("source","source_listing_id","card_hash","evidence_hash","rule_version"),
	CONSTRAINT "prints_source_check" CHECK ("copy_advert"."prints"."source" in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')),
	CONSTRAINT "prints_currency_check" CHECK ("copy_advert"."prints"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "prints_desc_status_check" CHECK ("copy_advert"."prints"."desc_status" in ('full_verified', 'partial', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "copy_advert"."reports" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_user_listing_key" UNIQUE("user_id","listing_id"),
	CONSTRAINT "reports_reason_check" CHECK ("copy_advert"."reports"."reason" in ('not_a_copy', 'other')),
	CONSTRAINT "reports_status_check" CHECK ("copy_advert"."reports"."status" in ('open', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX "links_b_idx" ON "copy_advert"."links" USING btree ("listing_b");--> statement-breakpoint
CREATE UNIQUE INDEX "members_one_active_idx" ON "copy_advert"."members" USING btree ("listing_id") WHERE "copy_advert"."members"."left_at" is null;--> statement-breakpoint
CREATE INDEX "prints_advert_idx" ON "copy_advert"."prints" USING btree ("advert_fp","last_seen_at") WHERE "copy_advert"."prints"."current";--> statement-breakpoint
CREATE INDEX "prints_desc_idx" ON "copy_advert"."prints" USING btree ("desc_fp") WHERE "copy_advert"."prints"."current";--> statement-breakpoint
CREATE INDEX "prints_photo_idx" ON "copy_advert"."prints" USING btree ("photo_id") WHERE "copy_advert"."prints"."current";--> statement-breakpoint
CREATE INDEX "prints_listing_idx" ON "copy_advert"."prints" USING btree ("listing_id");