CREATE SCHEMA "pricing_console";
--> statement-breakpoint
CREATE TABLE "pricing_console"."policy_rows" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"target_user_id" uuid,
	"effective_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_rows_kind" CHECK ("pricing_console"."policy_rows"."kind" in ('tier', 'price', 'bundle', 'offer', 'free-tier', 'setting', 'cost-basis')),
	CONSTRAINT "policy_rows_key" CHECK ("pricing_console"."policy_rows"."key" ~ '^[a-z][a-z0-9-]{0,62}$'),
	CONSTRAINT "policy_rows_version" CHECK ("pricing_console"."policy_rows"."version" >= 1),
	CONSTRAINT "policy_rows_value" CHECK (jsonb_typeof("pricing_console"."policy_rows"."value") = 'object'),
	CONSTRAINT "policy_rows_target" CHECK ("pricing_console"."policy_rows"."target_user_id" is null or "pricing_console"."policy_rows"."kind" = 'offer'),
	CONSTRAINT "policy_rows_reason" CHECK ("pricing_console"."policy_rows"."reason" is null or length("pricing_console"."policy_rows"."reason") <= 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rows_kind_key_version_key" ON "pricing_console"."policy_rows" USING btree ("kind","key","version");--> statement-breakpoint
CREATE INDEX "policy_rows_target_user_id_idx" ON "pricing_console"."policy_rows" USING btree ("target_user_id");