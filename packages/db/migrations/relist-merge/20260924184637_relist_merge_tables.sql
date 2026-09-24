CREATE SCHEMA "relist_merge";
--> statement-breakpoint
CREATE TABLE "relist_merge"."groups" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relist_merge"."members" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"group_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"matched_listing_id" uuid,
	"input_fetched_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_listing_key" UNIQUE("listing_id"),
	CONSTRAINT "members_basis_check" CHECK ("relist_merge"."members"."basis" in ('origin', 'description', 'photo')),
	CONSTRAINT "members_matched_check" CHECK (("relist_merge"."members"."basis" = 'origin') = ("relist_merge"."members"."matched_listing_id" is null)),
	CONSTRAINT "members_not_self_check" CHECK ("relist_merge"."members"."matched_listing_id" <> "relist_merge"."members"."listing_id")
);
--> statement-breakpoint
ALTER TABLE "relist_merge"."members" ADD CONSTRAINT "members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "relist_merge"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_group_idx" ON "relist_merge"."members" USING btree ("group_id");