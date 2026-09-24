CREATE SCHEMA "incidents";
--> statement-breakpoint
CREATE TABLE "incidents"."incidents" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"error" jsonb NOT NULL,
	"attempts" integer NOT NULL,
	"first_failed_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_event_type_event_key_key" UNIQUE("event_type","event_key")
);
--> statement-breakpoint
CREATE INDEX "incidents_open_idx" ON "incidents"."incidents" USING btree ("resolved_at");
