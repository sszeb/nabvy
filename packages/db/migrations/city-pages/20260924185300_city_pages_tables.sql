CREATE SCHEMA "city_pages";
--> statement-breakpoint
CREATE TABLE "city_pages"."centres" (
	"city_page_id" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_by_job" integer,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"reported_lat" double precision,
	"reported_lng" double precision,
	"area_km" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "centres_country_check" CHECK ("city_pages"."centres"."country" in ('GB', 'IE')),
	CONSTRAINT "centres_currency_check" CHECK ("city_pages"."centres"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "centres_area_km_check" CHECK ("city_pages"."centres"."area_km" > 0),
	CONSTRAINT "centres_verified_job_check" CHECK ("city_pages"."centres"."verified" or "city_pages"."centres"."verified_by_job" is null),
	CONSTRAINT "centres_reported_coords_check" CHECK (("city_pages"."centres"."reported_lat" is null) = ("city_pages"."centres"."reported_lng" is null)
        and ("city_pages"."centres"."reported_lat" is null or "city_pages"."centres"."reported_lat" between -90 and 90)
        and ("city_pages"."centres"."reported_lng" is null or "city_pages"."centres"."reported_lng" between -180 and 180))
);
--> statement-breakpoint
CREATE TABLE "city_pages"."city_pages" (
	"city_page_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"towns" text[] DEFAULT '{}'::text[] NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"coord_source" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "city_pages_coord_source_check" CHECK ("city_pages"."city_pages"."coord_source" in ('seed', 'card')),
	CONSTRAINT "city_pages_coords_check" CHECK (("city_pages"."city_pages"."lat" is null) = ("city_pages"."city_pages"."lng" is null)
        and ("city_pages"."city_pages"."lat" is null or "city_pages"."city_pages"."lat" between -90 and 90)
        and ("city_pages"."city_pages"."lng" is null or "city_pages"."city_pages"."lng" between -180 and 180))
);
--> statement-breakpoint
ALTER TABLE "city_pages"."centres" ADD CONSTRAINT "centres_city_page_id_city_pages_city_page_id_fk" FOREIGN KEY ("city_page_id") REFERENCES "city_pages"."city_pages"("city_page_id") ON DELETE no action ON UPDATE no action;