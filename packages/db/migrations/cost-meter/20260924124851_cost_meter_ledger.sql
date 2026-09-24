CREATE SCHEMA "cost_meter";
--> statement-breakpoint
CREATE TABLE "cost_meter"."provider_calls" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"module" text NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"currency" text NOT NULL,
	"reserved_micros" bigint NOT NULL,
	"settled_micros" bigint,
	"usd_gbp_rate" numeric(12, 6) NOT NULL,
	"reserved_gbp_micros" bigint NOT NULL,
	"settled_gbp_micros" bigint,
	"settled_at" timestamp with time zone,
	"latency_ms" integer,
	"status" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_calls_provider_ref_id_key" UNIQUE("provider","ref_id"),
	CONSTRAINT "provider_calls_provider_check" CHECK ("cost_meter"."provider_calls"."provider" in ('apify', 'anthropic', 'ebay', 'cex')),
	CONSTRAINT "provider_calls_kind_check" CHECK ("cost_meter"."provider_calls"."kind" in ('actor_run', 'model_call', 'api_call')),
	CONSTRAINT "provider_calls_currency_check" CHECK ("cost_meter"."provider_calls"."currency" in ('USD', 'GBP')),
	CONSTRAINT "provider_calls_status_check" CHECK ("cost_meter"."provider_calls"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "provider_calls_amounts_check" CHECK ("cost_meter"."provider_calls"."reserved_micros" >= 0 and "cost_meter"."provider_calls"."reserved_gbp_micros" >= 0 and coalesce("cost_meter"."provider_calls"."settled_micros", 0) >= 0 and coalesce("cost_meter"."provider_calls"."settled_gbp_micros", 0) >= 0 and "cost_meter"."provider_calls"."usd_gbp_rate" > 0),
	CONSTRAINT "provider_calls_settlement_check" CHECK (("cost_meter"."provider_calls"."settled_at" is null) = ("cost_meter"."provider_calls"."settled_micros" is null) and ("cost_meter"."provider_calls"."settled_at" is null) = ("cost_meter"."provider_calls"."settled_gbp_micros" is null)),
	CONSTRAINT "provider_calls_latency_check" CHECK ("cost_meter"."provider_calls"."latency_ms" is null or "cost_meter"."provider_calls"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX "provider_calls_at_idx" ON "cost_meter"."provider_calls" USING btree ("at");