-- Access for the router_gateway schema (packages/db/README.md, "Adding tables to a module";
-- services/router-gateway/README.md). router_calls is pipeline data with no user rows, so no
-- user_id and no RLS. Only the pipeline role (nabvy_pipeline) reads and writes it: a call is
-- inserted as `pending` (its quota reservation) and then updated once with its outcome, latency
-- and the build the provider reported. No other column is ever updated, nothing is deleted, and
-- nabvy_app gets nothing: the browser never reaches a routing provider or this log. No views.

grant usage on schema router_gateway to nabvy_pipeline;
grant select, insert on router_gateway.router_calls to nabvy_pipeline;
grant update (status, latency_ms, build) on router_gateway.router_calls to nabvy_pipeline;
