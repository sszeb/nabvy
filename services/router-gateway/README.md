# @nabvy/router-gateway

The only client of a road-routing provider: road distance (metres) and rough travel time (seconds) through `table()` and `route()`, server-side only (`docs/design/modules/router-gateway.md`; `docs/decisions.md`, "Routing: openrouteservice first").

## Switch and priority

Off by default (rule 11). The gateway calls only while its module switch `router-gateway` is `on` or `shadow` (it has no user-facing output, so shadow behaves like on) and the provider switch named after the configured provider (`openrouteservice`, kind `provider`) is `on`. Unknown or unreadable switches read `off`. While off, over quota, unconfigured or with the provider down, every call throws a typed `RouterError` and callers fall back: `travel-time` to straight line × 1.3, labelled an estimate; the route planner orders the day on that estimate and keeps navigation links. MVP, task 4.1i (owner, 2026-09-25).

## Inputs

- `@nabvy/config/modules/router-gateway`: `ROUTER_PROVIDER` (default `openrouteservice`), `ROUTER_BASE_URL` (default `https://api.openrouteservice.org`, https only) and the secret `ROUTER_API_KEY`; the caps and limits below.
- Switches `router-gateway` and the provider's, through `@nabvy/switches`.
- No events consumed; no other module's views.

## Outputs

- **Functions** (`@nabvy/router-gateway`):
  - `table({ sources, destinations }, deps)` → `RouterTableResult` `{ provider, build, distancesM, durationsS }`, every source to every destination, null where no road route exists.
  - `route({ points }, deps)` → `RouterRouteResult` `{ provider, build, distanceM, durationS }`, through the stops in order; no geometry.
  - `health(deps)` → `RouterHealth` `{ provider, status: ok | unknown | off | quota | down | unconfigured, build, checkedAt }`; makes no provider call.
  - `RouterError` with `code`: `router.off`, `router.quota`, `router.unconfigured`, `router.too-large`, `router.provider`, `router.invalid-response`.
  - `deps`: `publisher` (required for `table`/`route`), `run` (defaults to `withPipeline`), and test seams `env`, `fetch`, `now`, `log`.
- **Event** `router.build-changed` v1 `{ provider, osmBuild, at }`, key `router.build-changed:<provider>@<build>`, when a successful call reports a different provider or data build than the previous successful call. The first call ever announces nothing (nothing was cached before it).
- **Views:** none.

## Tables

`router_gateway.router_calls`: `id` (UUID v7, time-ordered), `provider`, `kind` (`table | route | health`), `location_count`, `latency_ms`, `status` (`pending | ok | refused_quota | provider_quota | http_error | invalid_response | timeout | network_error`), `build`, `at`. Index `(provider, kind, at)`. No coordinate, key or response body; `packages/db/tests/router-gateway.test.sql` fails on any column that could hold one. `nabvy_pipeline` may insert and update only `status`, `latency_ms` and `build`; nothing is deleted; `nabvy_app` has no access.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| openrouteservice Matrix V2 (`table`) cap | 500 a UTC day, 40 a minute | Free Standard plan page as read on 2026-09-25 (`docs/decisions.md`) | Plan figure |
| openrouteservice Directions V2 (`route`) cap | 2000 a UTC day, 40 a minute | Same | Plan figure |
| `osrm` caps | Same as above | No self-hosted router yet | Starting value |
| What counts | Every reserved call, whatever its outcome; not `refused_quota` | A failed call may still cost the plan a request | Fixed |
| Locations per `table()` | 50 | Nabvy's own; provider limit unconfirmed (`docs/questions/router-gateway.md`) | Starting value |
| Stops per `route()` | 25 | Nabvy's own; a one-day haul | Starting value |
| Timeout | 10 s | Callers fall back rather than wait | Starting value |
| Response size | 1 MB | A 50-location matrix is well under 100 KB | Starting value |
| Health window | 15 minutes | Newest settled call decides | Starting value |

## Fixtures and pass rate

Stage `provider` (`test/fixtures/provider.fixtures.ts`), 9 cases of recorded openrouteservice answers in the documented shapes, replayed through `table()`/`route()` on PGlite with the gateway open: the Matrix V2 documentation's example, an unroutable pair, a wrong-shaped matrix, hostile types, a Directions V2 summary, a zero-length route, a 429, a 500 and an HTML body. All are synthetic (`"synthetic": true`): no live call was made from this session or any test. Pass rate 9/9. Unit tests: `domain.test.ts` (quota boundaries, UTC day, build change, health, request mapping), `quota.test.ts` (the 501st matrix call of a day and the 41st of a minute are refused without calling the provider), `switch.test.ts`, `idempotency.test.ts`, `privacy.test.ts` (no coordinate or key in rows or logs; key only in a header; network failure, timeout, oversized body, too many locations), `contracts.test.ts`.

## Decisions

- 2026-09-25: openrouteservice first behind the `RouterProvider` adapter (`src/domain/provider.ts`); the `driving-car` profile; requests `units: 'm'`, no geometry, no instructions; coordinates sent `[lon, lat]` rounded to 6 decimals. Shapes from openrouteservice's published documentation and API source (Matrix endpoint page; `JSONRouteResponse`, `JSONSummary`, `EngineInfo`), read 2026-09-25. The plan page's caps (read the same day) are config defaults.
- 2026-09-25: the key travels in the `Authorization` header only, never in a URL, body, log or row; redirects are refused so the header cannot follow one elsewhere.
- 2026-09-25: the gateway runs its own short transactions: it reserves a `pending` row under a per-provider-and-kind advisory lock before the call, and records the outcome after it. No transaction stays open across HTTP, and a failed call still counts against the cap even if the caller's own work rolls back.
- 2026-09-25: the data build is `engine.osm_date`, else `engine.graph_date` (EngineInfo's `0000-00-00T00:00:00Z` means unknown); a value that is not a plain date or version string is dropped.
- 2026-09-25: a missing summary distance or duration reads as 0 (openrouteservice omits empty summary fields); an unroutable matrix pair stays null.
- 2026-09-25: `health()` makes no provider call (no public health endpoint; a probe would spend quota).
- 2026-09-25: `router.build-changed` is published right after the outcome commits; its key dedupes repeats.

## Open questions

- `docs/questions/router-gateway.md`: variables in `docs/secrets.md`; no public health endpoint; per-request limits; event and error names; provider switch; retention.

## Incidents

None.
