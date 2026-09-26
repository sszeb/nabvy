CREATE SCHEMA "asking_price_index";
--> statement-breakpoint
CREATE TABLE "asking_price_index"."groups" (
	"group_key" text PRIMARY KEY NOT NULL,
	"catalogue_id" text NOT NULL,
	"context" text NOT NULL,
	"condition" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"window_days" integer NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_context_check" CHECK ("asking_price_index"."groups"."context" in ('standalone', 'in_pc', 'bundle')),
	CONSTRAINT "groups_condition_check" CHECK ("asking_price_index"."groups"."condition" in ('new', 'used_like_new', 'used_good', 'used_fair')),
	CONSTRAINT "groups_country_check" CHECK ("asking_price_index"."groups"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "groups_currency_check" CHECK ("asking_price_index"."groups"."currency" in ('GBP', 'EUR')),
	CONSTRAINT "groups_window_check" CHECK ("asking_price_index"."groups"."window_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "asking_price_index"."members" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"group_key" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"ask_minor" bigint NOT NULL,
	"counted" boolean NOT NULL,
	"excluded" text,
	"sample_origin" text NOT NULL,
	"collapse_key" text NOT NULL,
	"city_page_id" text,
	"seen_at" timestamp with time zone NOT NULL,
	"card_hash" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_group_listing_key" UNIQUE("group_key","listing_id"),
	CONSTRAINT "members_ask_check" CHECK ("asking_price_index"."members"."ask_minor" >= 0),
	CONSTRAINT "members_origin_check" CHECK ("asking_price_index"."members"."sample_origin" in ('on_target', 'by_catch')),
	CONSTRAINT "members_counted_check" CHECK (not ("asking_price_index"."members"."counted" and "asking_price_index"."members"."excluded" is not null)),
	CONSTRAINT "members_excluded_check" CHECK ("asking_price_index"."members"."excluded" in ('noise', 'zero_price', 'money_kind', 'sold', 'unverified_binding', 'promoted', 'suppressed', 'stale', 'relist', 'copy', 'seller', 'outlier'))
);
--> statement-breakpoint
CREATE TABLE "asking_price_index"."stats" (
	"group_key" text PRIMARY KEY NOT NULL,
	"n" integer NOT NULL,
	"median" bigint,
	"mad" bigint,
	"p25" bigint,
	"p75" bigint,
	"min" bigint,
	"max" bigint,
	"thin" boolean NOT NULL,
	"copy_collapse" boolean NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stats_n_check" CHECK ("asking_price_index"."stats"."n" >= 0)
);
--> statement-breakpoint
ALTER TABLE "asking_price_index"."members" ADD CONSTRAINT "members_group_key_groups_group_key_fk" FOREIGN KEY ("group_key") REFERENCES "asking_price_index"."groups"("group_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asking_price_index"."stats" ADD CONSTRAINT "stats_group_key_groups_group_key_fk" FOREIGN KEY ("group_key") REFERENCES "asking_price_index"."groups"("group_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_catalogue_idx" ON "asking_price_index"."groups" USING btree ("catalogue_id");--> statement-breakpoint
CREATE INDEX "members_listing_idx" ON "asking_price_index"."members" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "members_group_idx" ON "asking_price_index"."members" USING btree ("group_key");