CREATE SCHEMA "pickup_location";
--> statement-breakpoint
CREATE TABLE "pickup_location"."ai_queue" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"evidence_hash" text NOT NULL,
	"reason" text NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_queue_listing_hash_key" UNIQUE("listing_id","evidence_hash"),
	CONSTRAINT "ai_queue_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_queue_reason_check" CHECK ("pickup_location"."ai_queue"."reason" in ('uncertain', 'delivers_elsewhere'))
);
--> statement-breakpoint
CREATE TABLE "pickup_location"."candidates" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"resolution_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"area_id" text,
	"lat" double precision,
	"lng" double precision,
	"role" text NOT NULL,
	"cue" text,
	"strength" text NOT NULL,
	"rejection" text,
	"field_distance_km" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidates_resolution_seq_key" UNIQUE("resolution_id","seq"),
	CONSTRAINT "candidates_seq_check" CHECK ("pickup_location"."candidates"."seq" >= 0),
	CONSTRAINT "candidates_kind_check" CHECK ("pickup_location"."candidates"."kind" in ('place', 'postcode_full', 'postcode_district')),
	CONSTRAINT "candidates_role_check" CHECK (role in ('pickup', 'seller_base', 'meetup', 'near', 'delivery_area', 'origin', 'mention')),
	CONSTRAINT "candidates_strength_check" CHECK (strength in ('strong', 'medium', 'weak')),
	CONSTRAINT "candidates_rejection_check" CHECK ("pickup_location"."candidates"."rejection" is null or "pickup_location"."candidates"."rejection" in ('stop_list', 'tag_block', 'no_gazetteer_match', 'no_point', 'weak_cue', 'not_pickup_class', 'far_from_field')),
	CONSTRAINT "candidates_point_check" CHECK (("pickup_location"."candidates"."lat" is null) = ("pickup_location"."candidates"."lng" is null))
);
--> statement-breakpoint
CREATE TABLE "pickup_location"."current" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"resolution_id" uuid NOT NULL,
	"pass" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"status" text NOT NULL,
	"basis" text NOT NULL,
	"source" text NOT NULL,
	"decided_by" text DEFAULT 'rules' NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"approximate" boolean DEFAULT true NOT NULL,
	"town_or_area" text,
	"area_id" text,
	"area_district" text,
	"lat" double precision,
	"lng" double precision,
	"uncertainty_km" integer,
	"note_code" text,
	"note_place_label" text,
	"listed_in_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "current_pass_check" CHECK ("pickup_location"."current"."pass" in ('card', 'detail')),
	CONSTRAINT "current_status_check" CHECK (status in ('confirmed', 'from_description', 'conflicting', 'field_only', 'uncertain', 'unknown')),
	CONSTRAINT "current_basis_check" CHECK (basis in ('field', 'text', 'ai', 'fallback')),
	CONSTRAINT "current_source_check" CHECK (source in ('both', 'description', 'listing', 'none')),
	CONSTRAINT "current_note_check" CHECK (note_code is null or note_code in ('description_says_collection_from', 'listed_in', 'description_names_other_pickup', 'description_delivers_elsewhere', 'pickup_place_not_stated')),
	CONSTRAINT "current_district_check" CHECK ("pickup_location"."current"."area_district" is null or "pickup_location"."current"."area_district" ~ '^[A-Z]{1,2}[0-9]{1,2}$'),
	CONSTRAINT "current_point_check" CHECK (("pickup_location"."current"."lat" is null) = ("pickup_location"."current"."lng" is null)
        and ("pickup_location"."current"."lat" is null or "pickup_location"."current"."lat" between -90 and 90)
        and ("pickup_location"."current"."lng" is null or "pickup_location"."current"."lng" between -180 and 180)),
	CONSTRAINT "current_area_check" CHECK (("pickup_location"."current"."town_or_area" is null) = ("pickup_location"."current"."area_id" is null) and ("pickup_location"."current"."town_or_area" is null) = ("pickup_location"."current"."lat" is null))
);
--> statement-breakpoint
CREATE TABLE "pickup_location"."handover" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"evidence_hash" text NOT NULL,
	"collection" text DEFAULT 'unknown' NOT NULL,
	"meetup_offered" boolean DEFAULT false NOT NULL,
	"local_delivery" text DEFAULT 'none' NOT NULL,
	"postage" text DEFAULT 'none' NOT NULL,
	"delivery_only_text" boolean DEFAULT false NOT NULL,
	"postage_only_text" boolean DEFAULT false NOT NULL,
	"courier_only_text" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handover_collection_check" CHECK (collection in ('yes', 'no', 'unknown')),
	CONSTRAINT "handover_local_delivery_check" CHECK (local_delivery in ('field', 'text', 'none')),
	CONSTRAINT "handover_postage_check" CHECK (postage in ('field', 'text', 'none'))
);
--> statement-breakpoint
CREATE TABLE "pickup_location"."mentions" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"resolution_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"candidate_seq" integer NOT NULL,
	"source" text NOT NULL,
	"quote_start" integer NOT NULL,
	"quote_end" integer NOT NULL,
	"quote_redacted" text NOT NULL,
	"role" text NOT NULL,
	"cue" text,
	"strength" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mentions_resolution_seq_key" UNIQUE("resolution_id","seq"),
	CONSTRAINT "mentions_source_check" CHECK ("pickup_location"."mentions"."source" in ('title', 'description')),
	CONSTRAINT "mentions_position_check" CHECK ("pickup_location"."mentions"."quote_start" >= 0 and "pickup_location"."mentions"."quote_end" > "pickup_location"."mentions"."quote_start"),
	CONSTRAINT "mentions_role_check" CHECK (role in ('pickup', 'seller_base', 'meetup', 'near', 'delivery_area', 'origin', 'mention')),
	CONSTRAINT "mentions_strength_check" CHECK (strength in ('strong', 'medium', 'weak'))
);
--> statement-breakpoint
CREATE TABLE "pickup_location"."overrides" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"area_id" text NOT NULL,
	"town_or_area" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"by" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overrides_point_check" CHECK ("pickup_location"."overrides"."lat" between -90 and 90 and "pickup_location"."overrides"."lng" between -180 and 180),
	CONSTRAINT "overrides_reason_check" CHECK (length("pickup_location"."overrides"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "pickup_location"."resolutions" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"listing_id" uuid NOT NULL,
	"pass" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"status" text NOT NULL,
	"basis" text NOT NULL,
	"source" text NOT NULL,
	"confidence" text NOT NULL,
	"decided_by" text DEFAULT 'rules' NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"approximate" boolean DEFAULT true NOT NULL,
	"town_or_area" text,
	"area_id" text,
	"area_district" text,
	"lat" double precision,
	"lng" double precision,
	"uncertainty_km" integer,
	"note_code" text,
	"note_place_label" text,
	"listed_in_label" text,
	"field_label" text,
	"field_lat" double precision,
	"field_lng" double precision,
	"field_distance_km" double precision,
	"ai_eligible" boolean DEFAULT false NOT NULL,
	"input_fetched_at" timestamp with time zone,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolutions_listing_pass_hash_version_key" UNIQUE("listing_id","pass","evidence_hash","rule_version"),
	CONSTRAINT "resolutions_pass_check" CHECK ("pickup_location"."resolutions"."pass" in ('card', 'detail')),
	CONSTRAINT "resolutions_hash_check" CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "resolutions_version_check" CHECK (rule_version ~ '^r[0-9]+\.[0-9a-f]{8}$'),
	CONSTRAINT "resolutions_status_check" CHECK (status in ('confirmed', 'from_description', 'conflicting', 'field_only', 'uncertain', 'unknown')),
	CONSTRAINT "resolutions_basis_check" CHECK (basis in ('field', 'text', 'ai', 'fallback')),
	CONSTRAINT "resolutions_source_check" CHECK (source in ('both', 'description', 'listing', 'none')),
	CONSTRAINT "resolutions_confidence_check" CHECK ("pickup_location"."resolutions"."confidence" in ('high', 'medium', 'low', 'none')),
	CONSTRAINT "resolutions_decided_by_check" CHECK ("pickup_location"."resolutions"."decided_by" in ('rules', 'ai', 'review')),
	CONSTRAINT "resolutions_note_check" CHECK (note_code is null or note_code in ('description_says_collection_from', 'listed_in', 'description_names_other_pickup', 'description_delivers_elsewhere', 'pickup_place_not_stated')),
	CONSTRAINT "resolutions_district_check" CHECK ("pickup_location"."resolutions"."area_district" is null or "pickup_location"."resolutions"."area_district" ~ '^[A-Z]{1,2}[0-9]{1,2}$'),
	CONSTRAINT "resolutions_point_check" CHECK (("pickup_location"."resolutions"."lat" is null) = ("pickup_location"."resolutions"."lng" is null)
        and ("pickup_location"."resolutions"."lat" is null or "pickup_location"."resolutions"."lat" between -90 and 90)
        and ("pickup_location"."resolutions"."lng" is null or "pickup_location"."resolutions"."lng" between -180 and 180)),
	CONSTRAINT "resolutions_area_check" CHECK (("pickup_location"."resolutions"."town_or_area" is null) = ("pickup_location"."resolutions"."area_id" is null) and ("pickup_location"."resolutions"."town_or_area" is null) = ("pickup_location"."resolutions"."lat" is null)),
	CONSTRAINT "resolutions_uncertainty_check" CHECK ("pickup_location"."resolutions"."uncertainty_km" is null or "pickup_location"."resolutions"."uncertainty_km" between 0 and 500)
);
--> statement-breakpoint
ALTER TABLE "pickup_location"."candidates" ADD CONSTRAINT "candidates_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "pickup_location"."resolutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_location"."current" ADD CONSTRAINT "current_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "pickup_location"."resolutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_location"."mentions" ADD CONSTRAINT "mentions_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "pickup_location"."resolutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidates_listing_idx" ON "pickup_location"."candidates" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "mentions_listing_idx" ON "pickup_location"."mentions" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "resolutions_listing_idx" ON "pickup_location"."resolutions" USING btree ("listing_id");