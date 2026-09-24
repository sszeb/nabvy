CREATE SCHEMA "spend_governor";
--> statement-breakpoint
CREATE TABLE "spend_governor"."budgets" (
	"name" text PRIMARY KEY NOT NULL,
	"provider" text,
	"unit" text NOT NULL,
	"period" text NOT NULL,
	"limit_micros" bigint NOT NULL,
	"set_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_name_check" CHECK ("spend_governor"."budgets"."name" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
	CONSTRAINT "budgets_provider_check" CHECK ("spend_governor"."budgets"."provider" is null or "spend_governor"."budgets"."provider" in ('apify', 'anthropic', 'ebay', 'cex')),
	CONSTRAINT "budgets_unit_check" CHECK ("spend_governor"."budgets"."unit" in ('USD', 'GBP', 'GB')),
	CONSTRAINT "budgets_period_check" CHECK ("spend_governor"."budgets"."period" = 'month'),
	CONSTRAINT "budgets_limit_check" CHECK ("spend_governor"."budgets"."limit_micros" > 0),
	CONSTRAINT "budgets_set_by_check" CHECK (length("spend_governor"."budgets"."set_by") > 0)
);
--> statement-breakpoint
CREATE TABLE "spend_governor"."throttle" (
	"budget" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"committed_micros" bigint,
	"forecast_micros" bigint,
	"computed_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "throttle_level_check" CHECK ("spend_governor"."throttle"."level" in ('none', 'slow-free', 'slow-paid', 'slow-sweeps', 'hold-new')),
	CONSTRAINT "throttle_amounts_check" CHECK (coalesce("spend_governor"."throttle"."committed_micros", 0) >= 0 and coalesce("spend_governor"."throttle"."forecast_micros", 0) >= 0),
	CONSTRAINT "throttle_measured_check" CHECK (("spend_governor"."throttle"."committed_micros" is null) = ("spend_governor"."throttle"."forecast_micros" is null)),
	CONSTRAINT "throttle_valid_check" CHECK ("spend_governor"."throttle"."valid_until" > "spend_governor"."throttle"."computed_at")
);
--> statement-breakpoint
ALTER TABLE "spend_governor"."throttle" ADD CONSTRAINT "throttle_budget_budgets_name_fk" FOREIGN KEY ("budget") REFERENCES "spend_governor"."budgets"("name") ON DELETE cascade ON UPDATE no action;