CREATE SCHEMA "price_drop_watch";
--> statement-breakpoint
CREATE TABLE "price_drop_watch"."drops" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"watch_id" uuid NOT NULL,
	"from_minor" bigint NOT NULL,
	"to_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"card_hash" text NOT NULL,
	"relist_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drops_watch_card_key" UNIQUE("watch_id","card_hash"),
	CONSTRAINT "drops_currency_check" CHECK ("price_drop_watch"."drops"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "drops_from_check" CHECK ("price_drop_watch"."drops"."from_minor" >= 0),
	CONSTRAINT "drops_to_check" CHECK ("price_drop_watch"."drops"."to_minor" >= 0),
	CONSTRAINT "drops_is_drop_check" CHECK ("price_drop_watch"."drops"."to_minor" < "price_drop_watch"."drops"."from_minor"),
	CONSTRAINT "drops_card_hash_check" CHECK ("price_drop_watch"."drops"."card_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "price_drop_watch"."watches" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watches_user_listing_key" UNIQUE("user_id","listing_id")
);
--> statement-breakpoint
ALTER TABLE "price_drop_watch"."drops" ADD CONSTRAINT "drops_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "price_drop_watch"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drops_watch_idx" ON "price_drop_watch"."drops" USING btree ("watch_id");--> statement-breakpoint
CREATE INDEX "watches_listing_active_idx" ON "price_drop_watch"."watches" USING btree ("listing_id") WHERE "price_drop_watch"."watches"."active";