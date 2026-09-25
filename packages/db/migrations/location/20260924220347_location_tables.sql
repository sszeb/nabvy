CREATE SCHEMA "location";
--> statement-breakpoint
CREATE TABLE "location"."postcode_cache" (
	"postcode" text PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postcode_cache_lat_check" CHECK ("location"."postcode_cache"."lat" between -90 and 90),
	CONSTRAINT "postcode_cache_lng_check" CHECK ("location"."postcode_cache"."lng" between -180 and 180)
);
