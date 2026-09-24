<!-- Nabvy PR template (coordinator 6, 2026-09-24). Tick each line with the file:line that proves it, or write "n/a: <why>". The reviewer verifies claims; it should not have to rediscover them. -->

## What changed
<!-- Module, one paragraph. Files changed outside the module, each justified. -->

## Migrations, in order
<!-- packages/db/migrations/<module>/<file>.sql, what each depends on, none destructive. "None" if none. -->

## Self-check (the reviewer's recurring findings)
- [ ] Every timestamp that drives a cap, window or expiry comes from server time, never from caller input:
- [ ] Every contract input is bounded (no unbounded timestamp or text); model output is validated against a strict, price-free Zod schema:
- [ ] Idempotency: a replay test (same key twice writes once; out-of-order replay) and event keys derived from stored rows:
- [ ] RLS: `enable_user_rls` on user tables; `nabvy_app` grants are the minimum, column-level where possible; a restrictive policy where the app may insert only some kinds; the SQL test probes cross-user select, update and insert:
- [ ] Views: `security_invoker`, explicit columns, the switch filter; no seller field, photo ref, cost or model output in a user-facing view; `nabvy_core.view_violations()` is empty:
- [ ] Functions: `security definer` only where needed, `set search_path = pg_catalog`, revoked from public:
- [ ] Switch states: `off` refuses or records nothing, `shadow` hides user-facing rows; anything that moves money or sends to a user requires `on`:
- [ ] Tests: `vitest.config.ts` sets `hookTimeout: 60000` and `testTimeout: 30000`; fixture stage and pass rate stated; `pnpm db:dry-run` result stated:
- [ ] Docs: every backlog ID cited exists on `main` or on the coordinator's branch; questions in `docs/questions/<module>.md`; README has "Decisions":
- [ ] Dependencies: no new third-party package, or one line with the licence:

## For the reviewer
Head: <sha> · previous reviewed head: <sha or none> · critical-path priority: [cp N]
