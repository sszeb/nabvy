CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE TABLE "inventory"."items" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_key" text,
	"source_listing_id" uuid,
	"scan_id" uuid,
	"currency" text NOT NULL,
	"cost_minor" bigint NOT NULL,
	"bought_at" date NOT NULL,
	"sold_minor" bigint,
	"sold_at" date,
	"sold_on" text,
	"sold_recorded_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_names_something" CHECK ("inventory"."items"."product_key" is not null or "inventory"."items"."source_listing_id" is not null or "inventory"."items"."scan_id" is not null),
	CONSTRAINT "items_product_key" CHECK ("inventory"."items"."product_key" is null or (length("inventory"."items"."product_key") <= 200 and "inventory"."items"."product_key" ~ '^[a-z0-9-]+(:[a-z0-9-]+)+$')),
	CONSTRAINT "items_currency" CHECK ("inventory"."items"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "items_cost_minor" CHECK ("inventory"."items"."cost_minor" between 0 and 100000000),
	CONSTRAINT "items_sold_minor" CHECK ("inventory"."items"."sold_minor" is null or "inventory"."items"."sold_minor" between 0 and 100000000),
	CONSTRAINT "items_bought_at" CHECK ("inventory"."items"."bought_at" >= '2000-01-01'::date),
	CONSTRAINT "items_sale_together" CHECK (("inventory"."items"."sold_minor" is null) = ("inventory"."items"."sold_at" is null) and ("inventory"."items"."sold_minor" is null) = ("inventory"."items"."sold_recorded_at" is null)),
	CONSTRAINT "items_sold_after_bought" CHECK ("inventory"."items"."sold_at" is null or "inventory"."items"."sold_at" >= "inventory"."items"."bought_at"),
	CONSTRAINT "items_sold_on" CHECK ("inventory"."items"."sold_on" is null or ("inventory"."items"."sold_minor" is not null and "inventory"."items"."sold_on" in ('ebay', 'facebook', 'gumtree', 'vinted', 'cex')))
);
--> statement-breakpoint
CREATE INDEX "items_user_id_idx" ON "inventory"."items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "items_source_listing_id_idx" ON "inventory"."items" USING btree ("source_listing_id");--> statement-breakpoint
CREATE INDEX "items_scan_id_idx" ON "inventory"."items" USING btree ("scan_id");