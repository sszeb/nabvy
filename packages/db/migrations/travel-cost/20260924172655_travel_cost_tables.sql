CREATE SCHEMA "travel_cost";
--> statement-breakpoint
CREATE TABLE "travel_cost"."travel_rates" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"fuel" text DEFAULT '' NOT NULL,
	"engine_band" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT '' NOT NULL,
	"pence_amount" integer NOT NULL,
	"unit" text NOT NULL,
	"effective_from" date NOT NULL,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_rates_kind" CHECK ("travel_cost"."travel_rates"."kind" in ('advisory-fuel-rate', 'approved-mileage-rate', 'value-of-time')),
	CONSTRAINT "travel_rates_unit" CHECK ("travel_cost"."travel_rates"."unit" in ('mile', 'hour')),
	CONSTRAINT "travel_rates_fuel" CHECK ("travel_cost"."travel_rates"."fuel" in ('', 'petrol', 'diesel', 'lpg', 'electric')),
	CONSTRAINT "travel_rates_engine_band" CHECK ("travel_cost"."travel_rates"."engine_band" in ('', '1400-or-less', '1401-2000', '1600-or-less', '1601-2000', 'over-2000')),
	CONSTRAINT "travel_rates_tier" CHECK ("travel_cost"."travel_rates"."tier" in ('', 'standard', 'reduced')),
	CONSTRAINT "travel_rates_pence_amount_positive" CHECK ("travel_cost"."travel_rates"."pence_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "travel_cost"."user_travel_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preset" text DEFAULT 'fuel-only' NOT NULL,
	"fuel" text,
	"engine_band" text,
	"custom" jsonb,
	"value_of_time_pence_hour" integer,
	"road_factor" double precision,
	"speed_mph" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_travel_settings_preset" CHECK ("travel_cost"."user_travel_settings"."preset" in ('fuel-only', 'hmrc-business', 'custom')),
	CONSTRAINT "user_travel_settings_fuel" CHECK ("travel_cost"."user_travel_settings"."fuel" is null or "travel_cost"."user_travel_settings"."fuel" in ('petrol', 'diesel', 'lpg', 'electric')),
	CONSTRAINT "user_travel_settings_engine_band" CHECK ("travel_cost"."user_travel_settings"."engine_band" is null or "travel_cost"."user_travel_settings"."engine_band" in ('1400-or-less', '1401-2000', '1600-or-less', '1601-2000', 'over-2000')),
	CONSTRAINT "user_travel_settings_value_of_time_non_negative" CHECK ("travel_cost"."user_travel_settings"."value_of_time_pence_hour" is null or "travel_cost"."user_travel_settings"."value_of_time_pence_hour" >= 0),
	CONSTRAINT "user_travel_settings_road_factor_positive" CHECK ("travel_cost"."user_travel_settings"."road_factor" is null or "travel_cost"."user_travel_settings"."road_factor" > 0),
	CONSTRAINT "user_travel_settings_speed_positive" CHECK ("travel_cost"."user_travel_settings"."speed_mph" is null or "travel_cost"."user_travel_settings"."speed_mph" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "travel_rates_kind_fuel_band_tier_effective_idx" ON "travel_cost"."travel_rates" USING btree ("kind","fuel","engine_band","tier","effective_from");