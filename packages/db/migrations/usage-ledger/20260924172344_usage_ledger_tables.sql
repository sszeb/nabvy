CREATE SCHEMA "usage_ledger";
--> statement-breakpoint
CREATE TABLE "usage_ledger"."allocations" (
	"entry_id" uuid NOT NULL,
	"bucket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"credits" integer NOT NULL,
	CONSTRAINT "allocations_entry_id_bucket_id_pk" PRIMARY KEY("entry_id","bucket_id"),
	CONSTRAINT "allocations_credits" CHECK ("usage_ledger"."allocations"."credits" <> 0)
);
--> statement-breakpoint
CREATE TABLE "usage_ledger"."buckets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"rank" smallint NOT NULL,
	"credits" integer NOT NULL,
	"remaining" integer NOT NULL,
	"cash_minor" integer NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "buckets_remaining" CHECK ("usage_ledger"."buckets"."remaining" between 0 and "usage_ledger"."buckets"."credits"),
	CONSTRAINT "buckets_rank" CHECK ("usage_ledger"."buckets"."rank" = case "usage_ledger"."buckets"."kind" when 'allowance' then 1 when 'topup' then 3 else 2 end)
);
--> statement-breakpoint
CREATE TABLE "usage_ledger"."entries" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"credits" integer NOT NULL,
	"action" text,
	"ref_id" text NOT NULL,
	"reverses_id" uuid,
	"cash_minor" integer DEFAULT 0 NOT NULL,
	"cost_gbp_micros" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_kind" CHECK ("usage_ledger"."entries"."kind" in ('allowance', 'taste', 'referral', 'topup', 'charge', 'reversal', 'expiry')),
	CONSTRAINT "entries_credits_sign" CHECK (case when "usage_ledger"."entries"."kind" in ('allowance', 'taste', 'referral', 'topup') then "usage_ledger"."entries"."credits" > 0
               when "usage_ledger"."entries"."kind" = 'charge' then "usage_ledger"."entries"."credits" <= 0
               when "usage_ledger"."entries"."kind" = 'reversal' then "usage_ledger"."entries"."credits" >= 0
               else "usage_ledger"."entries"."credits" < 0 end),
	CONSTRAINT "entries_action" CHECK (("usage_ledger"."entries"."kind" = 'charge') = ("usage_ledger"."entries"."action" is not null)),
	CONSTRAINT "entries_reverses" CHECK (("usage_ledger"."entries"."kind" = 'reversal') = ("usage_ledger"."entries"."reverses_id" is not null)),
	CONSTRAINT "entries_cash" CHECK ("usage_ledger"."entries"."cash_minor" >= 0 and ("usage_ledger"."entries"."cash_minor" = 0 or "usage_ledger"."entries"."kind" in ('allowance', 'topup'))),
	CONSTRAINT "entries_cost" CHECK ("usage_ledger"."entries"."cost_gbp_micros" >= 0 and ("usage_ledger"."entries"."cost_gbp_micros" = 0 or "usage_ledger"."entries"."kind" = 'charge')),
	CONSTRAINT "entries_expires" CHECK ("usage_ledger"."entries"."expires_at" is null or "usage_ledger"."entries"."kind" in ('allowance', 'taste', 'referral', 'topup')),
	CONSTRAINT "entries_expiring_kinds" CHECK ("usage_ledger"."entries"."kind" not in ('allowance', 'taste') or "usage_ledger"."entries"."expires_at" is not null)
);
--> statement-breakpoint
CREATE INDEX "allocations_bucket_id_idx" ON "usage_ledger"."allocations" USING btree ("bucket_id");--> statement-breakpoint
CREATE INDEX "allocations_user_id_idx" ON "usage_ledger"."allocations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "buckets_user_id_spend_order_idx" ON "usage_ledger"."buckets" USING btree ("user_id","rank","expires_at","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_user_id_kind_ref_id_key" ON "usage_ledger"."entries" USING btree ("user_id","kind","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_reverses_id_key" ON "usage_ledger"."entries" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "entries_user_id_at_idx" ON "usage_ledger"."entries" USING btree ("user_id","at");