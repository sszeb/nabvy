CREATE SCHEMA "router_gateway";
--> statement-breakpoint
CREATE TABLE "router_gateway"."router_calls" (
	"id" uuid PRIMARY KEY DEFAULT nabvy_core.uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"location_count" integer NOT NULL,
	"latency_ms" integer,
	"status" text NOT NULL,
	"build" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "router_calls_provider_check" CHECK (provider in ('openrouteservice', 'osrm')),
	CONSTRAINT "router_calls_kind_check" CHECK (kind in ('table', 'route', 'health')),
	CONSTRAINT "router_calls_status_check" CHECK (status in ('pending', 'ok', 'refused_quota', 'provider_quota', 'http_error', 'invalid_response', 'timeout', 'network_error')),
	CONSTRAINT "router_calls_location_count_check" CHECK ("router_gateway"."router_calls"."location_count" >= 0),
	CONSTRAINT "router_calls_latency_check" CHECK ("router_gateway"."router_calls"."latency_ms" is null or "router_gateway"."router_calls"."latency_ms" >= 0),
	CONSTRAINT "router_calls_build_check" CHECK ("router_gateway"."router_calls"."build" is null or length("router_gateway"."router_calls"."build") <= 100)
);
--> statement-breakpoint
CREATE INDEX "router_calls_quota_idx" ON "router_gateway"."router_calls" USING btree ("provider","kind","at");