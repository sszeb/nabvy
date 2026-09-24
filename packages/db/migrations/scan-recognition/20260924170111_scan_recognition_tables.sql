CREATE SCHEMA "scan_recognition";
--> statement-breakpoint
CREATE TABLE "scan_recognition"."scan_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"barcode" text,
	"photo_ref" text,
	"photo_media_type" text,
	"photo_expires_at" timestamp (3) with time zone,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"identified" text,
	"candidates" text[] DEFAULT '{}'::text[] NOT NULL,
	"confidence" double precision,
	"confirmed" boolean DEFAULT false NOT NULL,
	"description" jsonb,
	"search_phrases" text[] DEFAULT '{}'::text[] NOT NULL,
	"model_called" boolean DEFAULT false NOT NULL,
	"model_ref" text,
	"output_valid" boolean,
	"prompt_version" text,
	"cost_gbp_micros" bigint DEFAULT 0 NOT NULL,
	"at" timestamp (3) with time zone NOT NULL,
	"identified_at" timestamp (3) with time zone,
	"confirmed_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_events_method" CHECK ("scan_recognition"."scan_events"."method" in ('barcode', 'cex_box', 'vision', 'none')),
	CONSTRAINT "scan_events_status" CHECK ("scan_recognition"."scan_events"."status" in ('identified', 'needs_confirmation', 'unidentified')),
	CONSTRAINT "scan_events_barcode_format" CHECK ("scan_recognition"."scan_events"."barcode" ~ '^([0-9]{8}|[0-9]{12,14})$'),
	CONSTRAINT "scan_events_photo_ref_per_user" CHECK ("scan_recognition"."scan_events"."photo_ref" like 'scans/' || "scan_recognition"."scan_events"."user_id"::text || '/%'),
	CONSTRAINT "scan_events_photo_media_type" CHECK ("scan_recognition"."scan_events"."photo_media_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "scan_events_confidence_range" CHECK ("scan_recognition"."scan_events"."confidence" between 0 and 1),
	CONSTRAINT "scan_events_candidates_max" CHECK (cardinality("scan_recognition"."scan_events"."candidates") <= 3),
	CONSTRAINT "scan_events_identified_is_candidate" CHECK ("scan_recognition"."scan_events"."identified" is null or "scan_recognition"."scan_events"."identified" = any("scan_recognition"."scan_events"."candidates")),
	CONSTRAINT "scan_events_status_consistent" CHECK (("scan_recognition"."scan_events"."status" = 'identified') = ("scan_recognition"."scan_events"."identified" is not null)
        and ("scan_recognition"."scan_events"."status" <> 'needs_confirmation' or cardinality("scan_recognition"."scan_events"."candidates") > 0)
        and (not "scan_recognition"."scan_events"."confirmed" or "scan_recognition"."scan_events"."identified" is not null)),
	CONSTRAINT "scan_events_cost_nonnegative" CHECK ("scan_recognition"."scan_events"."cost_gbp_micros" >= 0),
	CONSTRAINT "scan_events_model_fields" CHECK ("scan_recognition"."scan_events"."model_called" or ("scan_recognition"."scan_events"."model_ref" is null and "scan_recognition"."scan_events"."output_valid" is null and "scan_recognition"."scan_events"."cost_gbp_micros" = 0))
);
--> statement-breakpoint
CREATE INDEX "scan_events_user_id_at_idx" ON "scan_recognition"."scan_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "scan_events_photo_expires_at_idx" ON "scan_recognition"."scan_events" USING btree ("photo_expires_at") WHERE "scan_recognition"."scan_events"."photo_ref" is not null;