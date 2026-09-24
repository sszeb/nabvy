CREATE SCHEMA "switches";
--> statement-breakpoint
CREATE TABLE "switches"."switches" (
	"name" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'off' NOT NULL,
	"allow_list" uuid[],
	"changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid,
	CONSTRAINT "switches_name_format" CHECK ("switches"."switches"."name" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length("switches"."switches"."name") <= 100),
	CONSTRAINT "switches_kind" CHECK ("switches"."switches"."kind" in ('module', 'provider', 'gate', 'flag', 'global')),
	CONSTRAINT "switches_state" CHECK ("switches"."switches"."state" in ('off', 'shadow', 'on')),
	CONSTRAINT "switches_shadow_modules_only" CHECK ("switches"."switches"."kind" = 'module' or "switches"."switches"."state" <> 'shadow'),
	CONSTRAINT "switches_allow_list_gates_only" CHECK ("switches"."switches"."kind" = 'gate' or "switches"."switches"."allow_list" is null),
	CONSTRAINT "switches_allow_list_size" CHECK ("switches"."switches"."allow_list" is null or cardinality("switches"."switches"."allow_list") between 1 and 1000),
	CONSTRAINT "switches_always_on" CHECK ("switches"."switches"."name" not in ('audit-log', 'incidents', 'switches') or "switches"."switches"."state" = 'on')
);
