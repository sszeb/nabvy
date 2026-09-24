CREATE SCHEMA "product_catalogue";
--> statement-breakpoint
CREATE TABLE "product_catalogue"."aliases" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"catalogue_id" text NOT NULL,
	"alias" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aliases_alias_length" CHECK (length("product_catalogue"."aliases"."alias") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "product_catalogue"."codes" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"catalogue_id" text NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codes_kind" CHECK ("product_catalogue"."codes"."kind" in ('ean', 'cex_box'))
);
--> statement-breakpoint
CREATE TABLE "product_catalogue"."items" (
	"catalogue_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"family" text,
	"variant" text,
	"is_mobile" boolean DEFAULT false NOT NULL,
	"pack_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_catalogue_id_format" CHECK ("product_catalogue"."items"."catalogue_id" ~ '^[a-z0-9-]+(:[a-z0-9-]+)+$' and length("product_catalogue"."items"."catalogue_id") <= 200),
	CONSTRAINT "items_kind" CHECK ("product_catalogue"."items"."kind" in ('gpu', 'cpu'))
);
--> statement-breakpoint
CREATE TABLE "product_catalogue"."negative_contexts" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"pattern" text NOT NULL,
	"blocked_catalogue_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negative_contexts_pattern_length" CHECK (length("product_catalogue"."negative_contexts"."pattern") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "product_catalogue"."aliases" ADD CONSTRAINT "aliases_catalogue_id_items_catalogue_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "product_catalogue"."items"("catalogue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalogue"."codes" ADD CONSTRAINT "codes_catalogue_id_items_catalogue_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "product_catalogue"."items"("catalogue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalogue"."negative_contexts" ADD CONSTRAINT "negative_contexts_blocked_catalogue_id_items_catalogue_id_fk" FOREIGN KEY ("blocked_catalogue_id") REFERENCES "product_catalogue"."items"("catalogue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aliases_catalogue_id_alias_key" ON "product_catalogue"."aliases" USING btree ("catalogue_id","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "codes_kind_code_key" ON "product_catalogue"."codes" USING btree ("kind","code");--> statement-breakpoint
CREATE UNIQUE INDEX "negative_contexts_pattern_blocked_key" ON "product_catalogue"."negative_contexts" USING btree ("pattern","blocked_catalogue_id");