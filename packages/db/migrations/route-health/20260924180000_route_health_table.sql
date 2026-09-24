CREATE SCHEMA "route_health";
--> statement-breakpoint
CREATE TABLE "route_health"."route_state" (
	"region_id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_health"."route_runs" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"region_id" text NOT NULL,
	"apify_run_id" text NOT NULL,
	"detail_route" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_runs_apify_run_id_key" UNIQUE("apify_run_id")
);
--> statement-breakpoint
CREATE INDEX "route_runs_region_at_idx" ON "route_health"."route_runs" USING btree ("region_id","at");
