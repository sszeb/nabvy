CREATE SCHEMA "attribution";
--> statement-breakpoint
CREATE TABLE "attribution"."partner_events" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"partner_id" text,
	"amount_minor" integer,
	"currency" text,
	"reason" text,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_events_kind" CHECK ("attribution"."partner_events"."kind" in ('lead', 'sale', 'reversal')),
	CONSTRAINT "partner_events_reason" CHECK ("attribution"."partner_events"."reason" is null or ("attribution"."partner_events"."kind" = 'reversal' and "attribution"."partner_events"."reason" in ('chargeback', 'refund'))),
	CONSTRAINT "partner_events_currency" CHECK ("attribution"."partner_events"."currency" is null or "attribution"."partner_events"."currency" = 'GBP'),
	CONSTRAINT "partner_events_amount" CHECK ("attribution"."partner_events"."amount_minor" is null or "attribution"."partner_events"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attribution"."referral_codes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution"."referrals" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"referred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"credited_at" timestamp (3) with time zone,
	CONSTRAINT "referrals_not_self" CHECK ("attribution"."referrals"."referrer_user_id" <> "attribution"."referrals"."referred_user_id")
);
--> statement-breakpoint
CREATE TABLE "attribution"."utm_attributions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"affiliate_click_id" text,
	"affiliate_code" text,
	"affiliate_partner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "partner_events_user_id_kind_ref_id_key" ON "attribution"."partner_events" USING btree ("user_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "partner_events_user_id_at_idx" ON "attribution"."partner_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_code_key" ON "attribution"."referral_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_user_id_key" ON "attribution"."referrals" USING btree ("referred_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_user_id_idx" ON "attribution"."referrals" USING btree ("referrer_user_id");