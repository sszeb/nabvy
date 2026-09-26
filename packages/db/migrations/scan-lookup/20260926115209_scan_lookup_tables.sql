CREATE SCHEMA "scan_lookup";
--> statement-breakpoint
CREATE TABLE "scan_lookup"."lookups" (
	"scan_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"catalogue_id" text NOT NULL,
	"status" text NOT NULL,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"bands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lookups_status_check" CHECK ("scan_lookup"."lookups"."status" in ('priced', 'not_enough_asks')),
	CONSTRAINT "lookups_cost_check" CHECK ("scan_lookup"."lookups"."cost" >= 0),
	CONSTRAINT "lookups_latency_check" CHECK ("scan_lookup"."lookups"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX "lookups_user_id_idx" ON "scan_lookup"."lookups" USING btree ("user_id");