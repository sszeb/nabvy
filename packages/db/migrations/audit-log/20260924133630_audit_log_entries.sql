CREATE SCHEMA "audit_log";
--> statement-breakpoint
CREATE TABLE "audit_log"."entries" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_action_format" CHECK ("audit_log"."entries"."action" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length("audit_log"."entries"."action") <= 100),
	CONSTRAINT "entries_target_format" CHECK ("audit_log"."entries"."target" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*:\S+$' and length("audit_log"."entries"."target") <= 300),
	CONSTRAINT "entries_reason_length" CHECK ("audit_log"."entries"."reason" is null or (length(btrim("audit_log"."entries"."reason")) between 1 and 1000)),
	CONSTRAINT "entries_restricted_read_reason" CHECK ("audit_log"."entries"."action" <> 'audit-log.restricted-read' or "audit_log"."entries"."reason" is not null)
);
--> statement-breakpoint
CREATE INDEX "entries_at_idx" ON "audit_log"."entries" USING btree ("at");--> statement-breakpoint
CREATE INDEX "entries_actor_user_id_at_idx" ON "audit_log"."entries" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "entries_target_at_idx" ON "audit_log"."entries" USING btree ("target","at");