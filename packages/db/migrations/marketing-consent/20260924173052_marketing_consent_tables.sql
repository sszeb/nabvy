CREATE SCHEMA "marketing_consent";
--> statement-breakpoint
CREATE TABLE "marketing_consent"."email_suppressions" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_email_hash_format" CHECK ("marketing_consent"."email_suppressions"."email_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_suppressions_reason" CHECK ("marketing_consent"."email_suppressions"."reason" in ('bounce', 'complaint', 'unsubscribe', 'manual')),
	CONSTRAINT "email_suppressions_source" CHECK ("marketing_consent"."email_suppressions"."source" in ('resend', 'posthog', 'user', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "marketing_consent"."marketing_consents" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"until" timestamp (3) with time zone,
	"source" text NOT NULL,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_consents_user_id_category_pk" PRIMARY KEY("user_id","category"),
	CONSTRAINT "marketing_consents_category" CHECK ("marketing_consent"."marketing_consents"."category" in ('tips', 'offers', 'product_updates', 'weekly_digest', 'all')),
	CONSTRAINT "marketing_consents_source" CHECK ("marketing_consent"."marketing_consents"."source" in ('signup', 'preference-centre', 'admin')),
	CONSTRAINT "marketing_consents_until_only_on_pause" CHECK ("marketing_consent"."marketing_consents"."category" = 'all' or "marketing_consent"."marketing_consents"."until" is null)
);
--> statement-breakpoint
CREATE TABLE "marketing_consent"."newsletter_subscribers" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"consent_source" text NOT NULL,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp (3) with time zone,
	CONSTRAINT "newsletter_subscribers_email_hash_format" CHECK ("marketing_consent"."newsletter_subscribers"."email_hash" ~ '^[0-9a-f]{64}$')
);
