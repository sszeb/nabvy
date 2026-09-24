CREATE SCHEMA "product_events";
--> statement-breakpoint
CREATE TABLE "product_events"."events" (
	"id" uuid DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session_id" text,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
