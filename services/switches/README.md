# @nabvy/switches

Holds the state of every module, provider, gate, feature flag and the global pipeline pause, so any one of them can be stopped on its own (`docs/design/modules/switches.md`).

## Switch and priority

Cannot be switched off: its own row is `on` and the database refuses any other state. If it is unreachable, every reader fails closed: `state()` reads `off`, `isOn()` and `gateAllows()` read false, and views that filter on the SQL functions return no rows. P0: a kill switch per provider from day one (`docs/decisions.md:202`), one switch per module (`docs/decisions.md:65`).

## Inputs

Admin actions only: an admin procedure checks the session and calls `set()` inside `withPipeline` (the admin procedure itself is not built yet). Consumes no events; no module flips a switch automatically. Writes one audit row per change through `@nabvy/audit-log`'s `record()` in the same transaction.

## Outputs

- **Event** `switches.changed` v1, `{ names }`, keyed `switches.changed:<name>@<changed_at>`.
- **SQL functions** for views, SECURITY DEFINER, `EXECUTE` for `nabvy_app` and `nabvy_pipeline` only:
  - `switches.state(name) → text`: `off | shadow | on`; an unknown name is `off`.
  - `switches.is_on(name) → boolean`: true only for `on`.
  - `switches.gate_allows(gate, user_id) → boolean`: the gate is `on`, and its allow-list is null (open to all) or holds the user; an unknown gate, a non-gate, or a null user is false.
- **Internal view** `switches.v_state` (name, kind, state, allow_list, changed_at, changed_by): `nabvy_pipeline` only. No user-facing views.
- **Functions** from `@nabvy/switches`: `state(q, name)`, `isOn(q, name)`, `gateAllows(q, gate, userId)`, `list(q)`, `set(q, publisher, input)`, `SwitchesRefused`.

## Tables

`switches.switches`: `name` (primary key, kebab case, unique across kinds), `kind` (`module | provider | gate | flag | global`), `state` (default `off`), `allow_list uuid[]` (gates only), `changed_at`, `changed_by` (null for seeds). Check constraints: `shadow` for modules only; allow-lists for gates only, at most 1000 users; `audit-log`, `incidents` and `switches` always `on`. No role may delete a row: a switch is turned off, never removed.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Unknown name | `off` | Card: "an unknown name reads `off`" | Fixed |
| Always on | `audit-log`, `incidents`, `switches` | Their cards: cannot be switched off | Fixed |
| Shadow | Modules only | Rule 11 (`_rules.md`) | Fixed |
| Allow-list size | ≤ 1000 users | Keeps a gate row small; the alert gate is open to all today | Starting value |

## Fixtures and pass rate

Stage `set` (`test/fixtures/set.fixtures.ts`), 7 synthetic cases, each built from the card or a rule it cites: provider kill switch, repeat is a no-op, always-on refused, gate allow-list, unknown reads off, shadow provider refused, pipeline pause. Pass rate 7/7. `test/switches.test.ts` covers the SQL functions inside a sample view as the web app, fail-closed reads with the functions unreachable, and rollback when the audit row cannot be written; `packages/db/tests/switches.test.sql` covers grants and constraints on real Postgres.

## Decisions

- 2026-09-24: one flat name space across kinds; a module's switch is named after the module, a provider's after the provider (`apify`, `anthropic`, `ebay`, `cex`), the global pause is `pipeline`, the Facebook alert gate is `facebook-alerts`.
- 2026-09-24: the global pause is its own switch. `is_on('<module>')` does not fold it in, so pausing the pipeline does not empty user-facing views; pipeline stages check `isOn(q, 'pipeline')` themselves.
- 2026-09-24: writes run as `nabvy_pipeline` only (see open questions).
- 2026-09-24: a change to the current value writes nothing and re-publishes the last change's key, which the transport drops, so a publish lost after commit is recovered by repeating the change. A rolled-back change may leave a stray event; readers load the state by name, so it is harmless.
- 2026-09-24: migration seeds are not audited: `audit_log.entries` needs an actor, and a seed has none.

## Open questions

- `docs/questions.md`, "w1 switches: who may write a switch".
- `docs/questions.md`, "w1 switches: seeded states".

## Incidents

None.
