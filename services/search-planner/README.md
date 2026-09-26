# @nabvy/search-planner

Decides what to search: for each region that active wants need, a verified centre and a few
terms, never per user; and holds the owner's one-off runs (`docs/design/modules/search-planner.md`).
It does not schedule or submit runs: `check-scheduler` reads its views.

A module session edits only this folder, `packages/contracts/src/modules/search-planner.ts`,
`packages/config/src/modules/search-planner.ts`, `packages/db/src/schema/search-planner.ts`,
`packages/db/tests/search-planner.test.sql` and `packages/db/migrations/search-planner/`.

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). Off: `onWantManagerChanged` and
`replan` acknowledge and write nothing; `recordOneOffRun`, `addAdminTestPair` and
`removeAdminTestPair` refuse (`search-planner.off`); both views are empty, so nothing is
scheduled (card, "When off"). `setOneOffRunStatus` keeps recording, so a run already submitted
can still finish. Shadow behaves like on: the module has no user-facing output. P1, step 1
(`fb-scrap-engine/docs/HANDOFF.md:140-145`); critical-path priority [cp 2].

## Inputs

- `want-manager.changed` v1 `{ wantIds }` (`want-manager`), handled by `onWantManagerChanged`
  in batches: one replan per batch.
- `want_manager.v_want_terms_by_centre` (`want-manager`): `centreId`, `family`, `wantCount`,
  `paidWantCount` over active wants with a centre. Counts only, no user or want IDs.
- `city_pages.v_centres` (`city-pages`): `active` and `verified` per centre.
- `switches.state('search-planner')` and `switches.state('want-manager')` (`switches`).
- Admin actions (the caller checks the session and the admin role, then calls inside
  `withPipeline`): `addAdminTestPair`, `removeAdminTestPair`, `recordOneOffRun` with an
  approval. Each writes one row through `@nabvy/audit-log`'s `record()` in the same transaction.
- `side-discovery`'s related-search terms (soft edge): injected as
  `SearchPlannerDeps.pivotSuggestions`; the documented stub `noPivotSuggestions` answers none.
  Suggestions only: `pivotSuggestions()` returns them and never writes.

## Outputs

- **Event** `search-planner.plan-changed` v1 `{ centreIds }` (1-500 per envelope), returned by
  `replan`, `onWantManagerChanged`, `addAdminTestPair` and `removeAdminTestPair` for the caller
  to publish after its transaction commits. Key `search-planner.plan-changed:<hash[0:16]>`: sha256
  of the centres' new plan state, so a replayed change repeats its key (rule 8). Emitted when a
  centre's pairs, classes, counts, budget verdicts or activity change; a rank that moves only
  because another centre changed is written but announces nothing.
- **Internal view** `search_planner.v_plan` (`nabvy_pipeline`; `security_invoker`; empty while
  off): `centre_id`, `term`, `class`, `origins`, `want_count`, `paid_want_count`, `rank`. Only
  pairs of active plans inside the budget bound; one row per (centre, term). Row type
  `SearchPlannerPlan`.
- **Internal view** `search_planner.v_one_off_runs` (same grants): `id`, `purpose`, `input`,
  `approved` (a flag, never the approver's ID), `status`, `created_at`, `updated_at`. Row type
  `SearchPlannerOneOffRun`.
- **User-facing views:** none.
- **Functions** (`@nabvy/search-planner`): `replan(q)`, `onWantManagerChanged(q, payloads)`,
  `listPlan(q)`, `addAdminTestPair(q, input)`, `removeAdminTestPair(q, input)`,
  `recordOneOffRun(q, input)`, `setOneOffRunStatus(q, input)` (for `check-scheduler`),
  `listOneOffRuns(q)`, `pivotSuggestions(q, centreIds, deps?)`, `parseTerm`, and the pure
  `computePlan`, `diffPlan`, `planChangedKey`, `termOf`, `classOf`; `SearchPlannerRefused`.

## Tables

Schema `search_planner`, pipeline data only (no user rows; `allow_pipeline` policies, so every
other role is denied):

- `plans`: `centre_id` (primary key, a city-pages ID as a plain value), `active` (the centre is
  active and verified in city-pages and has a pair).
- `plan_terms`: primary key (`centre_id`, `term`, `origin`); `class` (`narrow | broad`),
  `origin` (`wants | pivot | admin-test`), `want_count`, `paid_want_count`, `in_budget`, `rank`
  (set exactly when in budget). Checks on the term's form and on paid ≤ wants.
- `one_off_runs`: `id` (UUID v7), `purpose` (`verification | gap-fill | actor-test | fixture`),
  `input` (JSONB, `SearchPlannerOneOffInput`), `centre_id` (for verifications), `approved_by`
  (the approver; required for every purpose but `verification`, check `one_off_runs_approved`),
  `status` (`pending | submitted | completed | failed | cancelled`). A partial unique index
  holds one live (pending, submitted or completed) verification per centre. No delete grant.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Terms per want | its family term (narrow) plus "gaming pc" and "pc" (broad) | Card; `fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:62` | Fixed by the card |
| A family as a term | lower case, spaces collapsed; a family that is no valid term names no pair | Terms come from catalogue families, never listing text | Starting value |
| Container term counts | the most-wanted family's counts at the centre (max, never a sum) | The view counts per family; one want may name two families, so a sum over-counts | Starting value |
| Pair life | while at least one active want needs it; none, no pair and nothing runs | `docs/decisions.md`, "Nothing runs unless a user asks" | Fixed |
| Runs only at | active, verified centres; an active unverified centre gets one verification run (its most-wanted narrow term), no approval | `docs/decisions.md`, "The grid"; `actor-integration.md` 2.1 step 4 | Fixed |
| Budget bound | floor($150 / $3.20) = 46 runnable pairs (`SEARCH_PLANNER_MAX_ACTIVE_PAIRS`) | `docs/decisions.md`, "Budget" and "Cadence within the budget" | $150 fixed; $3.20 the owner's estimate |
| Rank | admin test first, then paid wants, all wants, narrow before broad, centre, term | "favouring paying subscribers" (`docs/decisions.md`) | Starting value |
| Admin test pair | one audited pair with origin `admin-test`; refused and dropped once want-manager is `on` | Card; `actor-integration.md` task 1.2b | Fixed |
| One-off runs | verification needs no approval; every other purpose needs an audited approval | Card; `docs/decisions.md`, "The grid" | Fixed |
| Event batch | 500 centre IDs | Rule 7 | Fixed |

## Fixtures and pass rate

Stage `plan` (`test/fixtures/plan.fixtures.ts`), 6 synthetic cases (this module reads only
counts, never listing content): `rtx3090-admin-test-chichester`,
`admin-test-dropped-when-wants-on`, `two-centres-from-counts`, `last-want-leaves`,
`unverified-centre-needs-verification`, `budget-bound-favours-paid`. Pass rate 6/6
(2026-09-25).

Other tests: `test/domain.test.ts` (terms, classes, the bound's boundary values, container
counts, the diff and key, the run life), `test/plan.test.ts` (the card's tests on real
migrations in PGlite: a plan from want counts, a pair leaving with its last want, no user ID in
any plan table or view, verification without approval and once per centre, unapproved one-offs
refused in code and in the database, the audited admin pair and its refusal once want-manager
is on, no access for the web app), `test/idempotency.test.ts` (a replayed batch writes nothing
and emits nothing), `test/switch.test.ts`, `test/contracts.test.ts` (enums against check lists,
view row types against the Drizzle views, the event), and
`packages/db/tests/search-planner.test.sql` in `pnpm db:dry-run`.

## Decisions

- **2026-09-25: the plan is recomputed whole on each batch.** want-manager's view carries counts
  per centre and family, not want IDs, so an event's want IDs cannot say which pairs moved. The
  plan is small (centres × a few terms); recomputing it and writing only the difference makes the
  handler idempotent by construction.
- **2026-09-25: the budget bound is on pairs, from the owner's two numbers.** $150 a month over
  $3.20 a pair a month is 46 pairs; pairs past the bound stay stored with `in_budget` false and
  do not reach `v_plan`. Cadence inside the bound is `check-scheduler`'s and `spend-governor`'s.
- **2026-09-25: an unverified centre's pairs wait.** Its plan is inactive and spends no budget
  slot until city-pages marks it verified; the next replan then activates it.
- **2026-09-25: `plan_terms` is keyed by origin too.** The admin pair and a want for the same
  term are two rows, so removing one keeps the other; `v_plan` shows the pair once, with both
  origins, and it uses one budget slot.
- **2026-09-25: the approver's ID stays in the table.** The card lists `approved_by`; the view
  shows only `approved`, so no user ID leaves the module through a view.
- **2026-09-25: the automatic drop of admin pairs once want-manager is on writes no audit row.**
  The audit log needs an actor and a replan has none; the add and any manual removal are audited.

## Open questions

`docs/questions/search-planner.md`: the test hunt's terms and spelling; the per-pair cost after
T2; container counts as a lower bound; wants with no family; the admin pair's end; pivot
suggestions' route into the plan.

## Incidents

None.
