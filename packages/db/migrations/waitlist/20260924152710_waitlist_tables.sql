CREATE SCHEMA "waitlist";
--> statement-breakpoint
CREATE TABLE "waitlist"."entries" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"email" text NOT NULL,
	"postcode" text,
	"wanted_products" text[],
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_email_unique" UNIQUE("email"),
	CONSTRAINT "waitlist_entries_email_lower" CHECK ("waitlist"."entries"."email" = lower("waitlist"."entries"."email")),
	CONSTRAINT "waitlist_entries_postcode_format" CHECK ("waitlist"."entries"."postcode" is null or "waitlist"."entries"."postcode" ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-BD-HJLNP-UW-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "waitlist"."submission_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp (3) with time zone NOT NULL
);
