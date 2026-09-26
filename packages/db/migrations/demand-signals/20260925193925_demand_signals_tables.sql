CREATE SCHEMA "demand_signals";
--> statement-breakpoint
CREATE TABLE "demand_signals"."cells" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"week_start" date NOT NULL,
	"centre_id" text NOT NULL,
	"family" text NOT NULL,
	"wants" integer,
	"adverts" integer,
	"suppressed" boolean NOT NULL,
	"rule_version" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cells_week_start_monday_check" CHECK (extract(isodow from "demand_signals"."cells"."week_start") = 1),
	CONSTRAINT "cells_wants_check" CHECK ("demand_signals"."cells"."wants" is null or "demand_signals"."cells"."wants" >= 10),
	CONSTRAINT "cells_adverts_check" CHECK ("demand_signals"."cells"."adverts" is null or "demand_signals"."cells"."adverts" >= 10),
	CONSTRAINT "cells_suppressed_check" CHECK ("demand_signals"."cells"."suppressed" = ("demand_signals"."cells"."wants" is null and "demand_signals"."cells"."adverts" is null)),
	CONSTRAINT "cells_centre_id_check" CHECK (length("demand_signals"."cells"."centre_id") between 1 and 64),
	CONSTRAINT "cells_family_check" CHECK (length("demand_signals"."cells"."family") between 1 and 200),
	CONSTRAINT "cells_rule_version_check" CHECK ("demand_signals"."cells"."rule_version" ~ '^ds-[0-9]+$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cells_week_centre_family_version_key" ON "demand_signals"."cells" USING btree ("week_start","centre_id","family","rule_version");