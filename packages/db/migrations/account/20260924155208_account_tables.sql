CREATE SCHEMA "account";
--> statement-breakpoint
CREATE TABLE "account"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"hashed_key" text NOT NULL,
	"label" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "account"."deletion_requests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"requested_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"purge_by" timestamp (3) with time zone NOT NULL,
	"purged_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "account"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"session_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"paused_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account"."standing" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"until" timestamp (3) with time zone,
	"limits" jsonb,
	"action_id" uuid,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_status" CHECK ("account"."standing"."status" in ('active', 'suspended', 'banned')),
	CONSTRAINT "standing_suspended_has_until" CHECK ("account"."standing"."status" <> 'suspended' or "account"."standing"."until" is not null),
	CONSTRAINT "standing_only_suspended_has_until" CHECK ("account"."standing"."status" = 'suspended' or "account"."standing"."until" is null)
);
--> statement-breakpoint
CREATE TABLE "account"."telegram_link_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone,
	CONSTRAINT "telegram_link_codes_code_hash_format" CHECK ("account"."telegram_link_codes"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "account"."telegram_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"linked_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "account"."user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"analytics_consent" boolean DEFAULT false NOT NULL,
	"design_partner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "account"."api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_user_id_device_id_key" ON "account"."push_subscriptions" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_user_id_created_at_idx" ON "account"."telegram_link_codes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_chat_id_active_idx" ON "account"."telegram_links" USING btree ("chat_id") WHERE "account"."telegram_links"."revoked_at" is null;