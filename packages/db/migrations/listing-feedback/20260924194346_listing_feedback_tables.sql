CREATE SCHEMA "listing_feedback";
--> statement-breakpoint
CREATE TABLE "listing_feedback"."listing_state" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"state" text NOT NULL,
	"at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_state_state" CHECK ("listing_feedback"."listing_state"."state" in ('saved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "listing_feedback"."verdicts" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"alert_id" uuid,
	"verdict" text NOT NULL,
	"at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdicts_verdict" CHECK ("listing_feedback"."verdicts"."verdict" in ('real_deal', 'not_a_deal', 'bought')),
	CONSTRAINT "verdicts_alert_id_not_sentinel" CHECK ("listing_feedback"."verdicts"."alert_id" <> '00000000-0000-0000-0000-000000000000'::uuid)
);
--> statement-breakpoint
CREATE INDEX "listing_state_user_id_idx" ON "listing_feedback"."listing_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "listing_state_listing_id_idx" ON "listing_feedback"."listing_state" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_state_identity_idx" ON "listing_feedback"."listing_state" USING btree ("user_id","listing_id");--> statement-breakpoint
CREATE INDEX "verdicts_user_id_idx" ON "listing_feedback"."verdicts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verdicts_listing_id_idx" ON "listing_feedback"."verdicts" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "verdicts_alert_id_idx" ON "listing_feedback"."verdicts" USING btree ("alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verdicts_identity_idx" ON "listing_feedback"."verdicts" USING btree ("user_id","listing_id",coalesce("alert_id", '00000000-0000-0000-0000-000000000000'::uuid));