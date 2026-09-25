CREATE SCHEMA "subscriptions";
--> statement-breakpoint
CREATE TABLE "subscriptions"."billing_events" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"stripe_object_id" text,
	"user_id" uuid,
	"outcome" text NOT NULL,
	"stripe_created_at" timestamp (3) with time zone NOT NULL,
	"checkout_session_id" text,
	"consent_start_now" boolean,
	"consent_at" timestamp (3) with time zone,
	"signal" text,
	"card_fingerprint" text,
	"amount_minor" integer,
	"currency" text,
	"processed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_events_outcome" CHECK ("subscriptions"."billing_events"."outcome" in ('applied', 'recorded', 'stale', 'ignored')),
	CONSTRAINT "billing_events_signal" CHECK ("subscriptions"."billing_events"."signal" is null or "subscriptions"."billing_events"."signal" in ('payment_failed', 'dispute')),
	CONSTRAINT "billing_events_consent" CHECK (("subscriptions"."billing_events"."checkout_session_id" is null) = ("subscriptions"."billing_events"."consent_start_now" is null) and ("subscriptions"."billing_events"."consent_start_now" is null) = ("subscriptions"."billing_events"."consent_at" is null))
);
--> statement-breakpoint
CREATE TABLE "subscriptions"."customers" (
	"stripe_customer_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions"."entitlements" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"status" text NOT NULL,
	"areas" integer NOT NULL,
	"wants" integer NOT NULL,
	"channels" text[] NOT NULL,
	"base_cadence_seconds" integer,
	"floor_cadence_seconds" integer,
	"period_start" timestamp (3) with time zone,
	"period_end" timestamp (3) with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_end" timestamp (3) with time zone,
	"stripe_subscription_id" text,
	"interval_months" smallint,
	"period_cash_minor" integer,
	"cash_period_start" timestamp (3) with time zone,
	"policy_version" text,
	"last_event_id" text NOT NULL,
	"last_event_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_status" CHECK ("subscriptions"."entitlements"."status" in ('free', 'trialing', 'active', 'past_due')),
	CONSTRAINT "entitlements_counts" CHECK ("subscriptions"."entitlements"."areas" >= 0 and "subscriptions"."entitlements"."wants" >= 0),
	CONSTRAINT "entitlements_interval" CHECK ("subscriptions"."entitlements"."interval_months" is null or "subscriptions"."entitlements"."interval_months" in (1, 12)),
	CONSTRAINT "entitlements_cash" CHECK ("subscriptions"."entitlements"."period_cash_minor" is null or "subscriptions"."entitlements"."period_cash_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_stripe_event_id_key" ON "subscriptions"."billing_events" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "billing_events_user_id_idx" ON "subscriptions"."billing_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_events_stripe_object_id_idx" ON "subscriptions"."billing_events" USING btree ("stripe_object_id");--> statement-breakpoint
CREATE INDEX "entitlements_status_idx" ON "subscriptions"."entitlements" USING btree ("status");