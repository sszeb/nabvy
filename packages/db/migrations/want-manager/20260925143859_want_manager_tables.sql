CREATE SCHEMA "want_manager";
--> statement-breakpoint
CREATE TABLE "want_manager"."criteria" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"want_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"part_type" text NOT NULL,
	"catalogue_id" text,
	"family" text,
	"min_attr" jsonb,
	"or_better" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "criteria_position" CHECK ("want_manager"."criteria"."position" between 0 and 9),
	CONSTRAINT "criteria_part_type" CHECK ("want_manager"."criteria"."part_type" in ('gpu', 'cpu', 'ram', 'storage')),
	CONSTRAINT "criteria_shape" CHECK (case when "want_manager"."criteria"."part_type" in ('ram', 'storage') then "want_manager"."criteria"."min_attr" is not null else ("want_manager"."criteria"."catalogue_id" is not null or "want_manager"."criteria"."family" is not null) end)
);
--> statement-breakpoint
CREATE TABLE "want_manager"."preferences" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"hide_noise" boolean DEFAULT true NOT NULL,
	"hide_spam" boolean DEFAULT true NOT NULL,
	"hide_multi_quantity" boolean DEFAULT false NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"quiet_hours" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preferences_channels" CHECK (cardinality("want_manager"."preferences"."channels") <= 3 and "want_manager"."preferences"."channels" <@ array['push', 'telegram', 'email']::text[])
);
--> statement-breakpoint
CREATE TABLE "want_manager"."wants" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_km" integer NOT NULL,
	"centre_id" text,
	"centre_verified" boolean DEFAULT false NOT NULL,
	"price_cap_minor" bigint,
	"currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cadence_seconds" integer NOT NULL,
	"delivery_speed" text DEFAULT 'instant' NOT NULL,
	"delivery_methods" text[] NOT NULL,
	"alternatives" text DEFAULT 'variants_plus_tier' NOT NULL,
	"pc_containment" boolean DEFAULT false NOT NULL,
	"alternatives_max_price_minor" bigint,
	"instant_alternatives" boolean DEFAULT false NOT NULL,
	"instant_top_picks" boolean DEFAULT true NOT NULL,
	"filter" jsonb,
	"version_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wants_lat" CHECK ("want_manager"."wants"."lat" between -90 and 90),
	CONSTRAINT "wants_lng" CHECK ("want_manager"."wants"."lng" between -180 and 180),
	CONSTRAINT "wants_radius_km" CHECK ("want_manager"."wants"."radius_km" between 1 and 1000),
	CONSTRAINT "wants_currency" CHECK ("want_manager"."wants"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "wants_price_cap_minor" CHECK ("want_manager"."wants"."price_cap_minor" > 0),
	CONSTRAINT "wants_alternatives_max_price_minor" CHECK ("want_manager"."wants"."alternatives_max_price_minor" > 0),
	CONSTRAINT "wants_cadence_seconds" CHECK ("want_manager"."wants"."cadence_seconds" in (14400, 7200, 3600, 1800, 900, 300, 60)),
	CONSTRAINT "wants_delivery_speed" CHECK ("want_manager"."wants"."delivery_speed" in ('instant', 'batched_15', 'batched_60', 'daily')),
	CONSTRAINT "wants_delivery_methods" CHECK (cardinality("want_manager"."wants"."delivery_methods") between 1 and 2 and "want_manager"."wants"."delivery_methods" <@ array['collection', 'posted']::text[]),
	CONSTRAINT "wants_alternatives" CHECK ("want_manager"."wants"."alternatives" in ('off', 'variants', 'variants_plus_tier')),
	CONSTRAINT "wants_version_hash" CHECK ("want_manager"."wants"."version_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "want_manager"."criteria" ADD CONSTRAINT "criteria_want_id_wants_id_fk" FOREIGN KEY ("want_id") REFERENCES "want_manager"."wants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "criteria_user_id_idx" ON "want_manager"."criteria" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "criteria_catalogue_id_idx" ON "want_manager"."criteria" USING btree ("catalogue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "criteria_want_position_idx" ON "want_manager"."criteria" USING btree ("want_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "preferences_user_id_idx" ON "want_manager"."preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wants_user_id_idx" ON "want_manager"."wants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wants_centre_id_idx" ON "want_manager"."wants" USING btree ("centre_id");--> statement-breakpoint
CREATE INDEX "wants_active_idx" ON "want_manager"."wants" USING btree ("active");