CREATE SCHEMA "pickup_routes";
--> statement-breakpoint
CREATE TABLE "pickup_routes"."pickup_days" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"start_kind" text DEFAULT 'home' NOT NULL,
	"end_kind" text DEFAULT 'home' NOT NULL,
	"private_enc" "bytea",
	"start_time" text NOT NULL,
	"latest_finish" text NOT NULL,
	"max_drive_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_days_start_kind" CHECK ("pickup_routes"."pickup_days"."start_kind" in ('home', 'current', 'custom')),
	CONSTRAINT "pickup_days_end_kind" CHECK ("pickup_routes"."pickup_days"."end_kind" in ('home', 'open', 'custom')),
	CONSTRAINT "pickup_days_max_drive" CHECK ("pickup_routes"."pickup_days"."max_drive_minutes" is null or "pickup_routes"."pickup_days"."max_drive_minutes" between 10 and 720)
);
--> statement-breakpoint
CREATE TABLE "pickup_routes"."pickup_reminders" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"pickup_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp (3) with time zone NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_reminders_kind" CHECK ("pickup_routes"."pickup_reminders"."kind" in ('evening_before', 'leave_by', 'unagreed'))
);
--> statement-breakpoint
CREATE TABLE "pickup_routes"."pickups" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"private_enc" "bytea" NOT NULL,
	"has_point" boolean DEFAULT false NOT NULL,
	"stop_type" text DEFAULT 'collection' NOT NULL,
	"day" date NOT NULL,
	"window_kind" text NOT NULL,
	"window_start" text,
	"window_end" text,
	"service_minutes" integer DEFAULT 10 NOT NULL,
	"price_minor" integer,
	"bring_cash" boolean DEFAULT false NOT NULL,
	"size" text DEFAULT 'small' NOT NULL,
	"must_get" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'arranged' NOT NULL,
	"listing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickups_stop_type" CHECK ("pickup_routes"."pickups"."stop_type" in ('collection', 'meetup')),
	CONSTRAINT "pickups_window_kind" CHECK ("pickup_routes"."pickups"."window_kind" in ('at', 'between', 'after', 'before', 'unagreed')),
	CONSTRAINT "pickups_size" CHECK ("pickup_routes"."pickups"."size" in ('small', 'boot', 'large')),
	CONSTRAINT "pickups_status" CHECK ("pickup_routes"."pickups"."status" in ('arranged', 'tentative', 'collected', 'cancelled', 'no_show')),
	CONSTRAINT "pickups_service_minutes" CHECK ("pickup_routes"."pickups"."service_minutes" between 1 and 240),
	CONSTRAINT "pickups_price_minor" CHECK ("pickup_routes"."pickups"."price_minor" is null or "pickup_routes"."pickups"."price_minor" between 0 and 100000000),
	CONSTRAINT "pickups_label_length" CHECK (length("pickup_routes"."pickups"."label") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "pickup_routes"."planner_defaults" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"private_enc" "bytea",
	"day_start" text DEFAULT '09:00' NOT NULL,
	"latest_finish" text DEFAULT '18:00' NOT NULL,
	"end_at_home" boolean DEFAULT true NOT NULL,
	"service_minutes" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planner_defaults_service_minutes" CHECK ("pickup_routes"."planner_defaults"."service_minutes" between 1 and 240)
);
--> statement-breakpoint
CREATE TABLE "pickup_routes"."route_plans" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"day_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"mode" text NOT NULL,
	"basis" text NOT NULL,
	"osm_build" text,
	"start_at" timestamp (3) with time zone NOT NULL,
	"finish_at" timestamp (3) with time zone NOT NULL,
	"drive_seconds" integer NOT NULL,
	"distance_metres" integer NOT NULL,
	"cost_minor" integer,
	"cost_basis" text,
	"stops" jsonb NOT NULL,
	"unassigned" jsonb NOT NULL,
	"superseded_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_plans_mode" CHECK ("pickup_routes"."route_plans"."mode" in ('optimised', 'my_order')),
	CONSTRAINT "route_plans_basis" CHECK ("pickup_routes"."route_plans"."basis" in ('router', 'estimate')),
	CONSTRAINT "route_plans_version" CHECK ("pickup_routes"."route_plans"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pickup_routes"."pickup_reminders" ADD CONSTRAINT "pickup_reminders_pickup_id_pickups_id_fk" FOREIGN KEY ("pickup_id") REFERENCES "pickup_routes"."pickups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_routes"."route_plans" ADD CONSTRAINT "route_plans_day_id_pickup_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "pickup_routes"."pickup_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pickup_days_user_id_idx" ON "pickup_routes"."pickup_days" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_days_identity_idx" ON "pickup_routes"."pickup_days" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "pickup_reminders_user_id_idx" ON "pickup_routes"."pickup_reminders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pickup_reminders_due_idx" ON "pickup_routes"."pickup_reminders" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_reminders_identity_idx" ON "pickup_routes"."pickup_reminders" USING btree ("pickup_id","kind","due_at");--> statement-breakpoint
CREATE INDEX "pickups_user_id_idx" ON "pickup_routes"."pickups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pickups_user_day_idx" ON "pickup_routes"."pickups" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "pickups_day_idx" ON "pickup_routes"."pickups" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "planner_defaults_user_id_idx" ON "pickup_routes"."planner_defaults" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "route_plans_user_id_idx" ON "pickup_routes"."route_plans" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "route_plans_identity_idx" ON "pickup_routes"."route_plans" USING btree ("day_id","version");