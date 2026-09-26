CREATE SCHEMA "asking_price_position";
--> statement-breakpoint
CREATE TABLE "asking_price_position"."positions" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"ask_minor" bigint NOT NULL,
	"rank" integer,
	"n" integer NOT NULL,
	"percentile" double precision,
	"robust_z" double precision,
	"label" text NOT NULL,
	"median" bigint,
	"range_low" bigint,
	"range_high" bigint,
	"currency" text NOT NULL,
	"new_median" bigint,
	"new_n" integer,
	"card_hash" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"stats_as_of" timestamp with time zone NOT NULL,
	"rule_version" text NOT NULL,
	"positioned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_listing_group_key" UNIQUE("listing_id","group_key"),
	CONSTRAINT "positions_ask_check" CHECK ("asking_price_position"."positions"."ask_minor" >= 0),
	CONSTRAINT "positions_n_check" CHECK ("asking_price_position"."positions"."n" >= 0),
	CONSTRAINT "positions_rank_check" CHECK ("asking_price_position"."positions"."rank" is null or "asking_price_position"."positions"."rank" between 1 and "asking_price_position"."positions"."n" + 1),
	CONSTRAINT "positions_percentile_check" CHECK ("asking_price_position"."positions"."percentile" is null or "asking_price_position"."positions"."percentile" between 0 and 100),
	CONSTRAINT "positions_currency_check" CHECK ("asking_price_position"."positions"."currency" in ('GBP', 'EUR'))
);
--> statement-breakpoint
CREATE INDEX "positions_group_idx" ON "asking_price_position"."positions" USING btree ("group_key");