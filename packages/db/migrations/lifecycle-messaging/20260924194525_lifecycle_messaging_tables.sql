CREATE SCHEMA "lifecycle_messaging";
--> statement-breakpoint
CREATE TABLE "lifecycle_messaging"."programme_runs" (
	"user_id" uuid NOT NULL,
	"programme" text NOT NULL,
	"step" text NOT NULL,
	"triggered_at" timestamp (3) with time zone NOT NULL,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programme_runs_user_id_programme_step_triggered_at_pk" PRIMARY KEY("user_id","programme","step","triggered_at"),
	CONSTRAINT "programme_runs_programme" CHECK ("lifecycle_messaging"."programme_runs"."programme" in ('abandoned-onboarding', 'channel-not-linked', 'activation', 'cap-reached', 'trial', 'win-back', 're-engagement'))
);
