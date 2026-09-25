# Admin panel hardening (task 4.3t, G18, backlog 4.3ae)

Owner, 2026-09-24: every cap is adjustable from the admin panel, so the admin panel has to be hardened and adversarially audited. The panel can raise spend caps, turn switches off and reset breakers. Whoever holds it can spend Nabvy's money and read the data set, which makes it the most valuable target in the app. Threat rows F1–F4 in `docs/design/abuse-threat-model.md`.

## Requirements

| # | Control | Owner | Fixture |
| --- | --- | --- | --- |
| H1 | **Role checked on the server in every admin procedure and server action**, not only in the layout. Data is read only after the check passes | web layer, `auth` | `admin-direct-call`: every admin procedure called with a user session returns 403 and reads nothing |
| H2 | **Step-up**: any admin write needs Google sign-in with 2-step verification, or a passkey, within the last 15 minutes. A magic-link session alone can read but never write | `auth` | `admin-step-up` |
| H3 | **Device-bound elevated session**: the step-up is tied to the session and its device. A copied cookie on another device or network loses it, and every privileged write re-checks it | `auth` | `admin-session-theft` |
| H4 | **Demotion takes effect at once**: removing the admin role revokes the person's sessions and bypasses the 5-minute cookie cache for admin checks | `auth` | `admin-demote-now`: a demoted admin's next write is refused within one request |
| H5 | **Ceilings in config** that no admin edit can pass. For example: lifetime cap ≤ £5; £2-a-day row ≤ £20; free pool ≤ 50% of the provider monthly cap; day ≤ week ≤ month; no cap above the gateway's monthly cap. Raising a ceiling needs a code change and a review | `pricing-console`, `spend-governor` | `policy-ceiling` |
| H6 | **Confirmation that shows the money**: an edit to a cap, pool or switch shows the old and new values and the worst-case spend per day before it saves. Raising any cap by more than 2 times in 24 hours needs a typed confirmation | `pricing-console` | `cap-raise-confirm` |
| H7 | **An audit row for every change, or no change**: the row is written in the same transaction as the change, and no role can update or delete audit rows | `audit-log` | built: "an action rolls back when its audit row cannot be written" (`services/auth/test/admin.test.ts`) |
| H8 | **Founder alert on every admin write** to caps, pools, switches, breakers and roles, sent through a channel other than the admin's own session | `ops-alerts` | `admin-write-alert` |
| H9 | **Rate limits on admin writes**: at most 30 an hour per admin; a third breaker reset in an hour needs a written reason | web layer, `spend-governor` | `breaker-reset-rate` |
| H10 | **Separate origin and strict CSP**: admin pages send `frame-ancestors 'none'`, load no third-party scripts (no analytics on admin pages), and check the origin on every server action | web layer | `admin-csp` |
| H11 | **No impersonation** and no Better Auth admin endpoints that write around the audited functions | `auth` | built: "an admin cannot impersonate-user" |
| H12 | **Admin bootstrap only from `ADMIN_EMAILS`** with a verified email, matched on the canonical form; no alias or Unicode look-alike is promoted | `auth` | `admin-bootstrap-alias` |
| H13 | **Fixture data never reaches production admin pages**: the admin data source is chosen on the server by environment | web layer | `admin-no-fixtures-in-prod` |

## Adversarial audit (2026-09-24, code on `main` at `583a4c0`)

One top-tier audit read the admin surface that exists today: `apps/web/src/app/admin/`, `services/auth`, `services/switches`, `services/audit-log` and their grants. It found 1 blocker, 3 major and 8 minor findings. Nothing is deployed yet (Vercel waits on 0.5a), and the admin pages show fixtures only, so none of them is live. All must be fixed before the web app is deployed. The fixes go into the backlog rows below; this PR changes docs only.

| # | Severity | Finding | Fix | Row |
| --- | --- | --- | --- | --- |
| A1 | **Blocker** | `/admin` has no authentication. The layout says role checks come later (`apps/web/src/app/admin/layout.tsx:4`). There is no middleware, and the web app does not depend on `@nabvy/auth` | `requireAdmin` in every admin page, procedure and action, not only the layout; `forbidden()` and `unauthorized()`; `noindex`; an e2e test that anonymous and user sessions get 401 and 403 (H1) | 4.3af |
| A2 | Major | The Facebook kill switch in admin changes only local state but says "Stopped" (`apps/web/src/components/provider-switch.tsx:9`). In an incident an admin would believe spending had stopped | Read-only until it calls an audited `switches.set` procedure; the label shows the server state after commit | 4.3af |
| A3 | Major | `nabvy_pipeline` can update `switches.switches` directly, with no audit row (`packages/db/migrations/switches/*_switches_access.sql:53`). `switches.set()` takes the actor from its input with no admin check. Pipeline audit rows may name any actor | A `security definer` `switches.set_switch(actor, …)` that checks for an active admin and writes the switch and audit row together; revoke insert and update from the pipeline; pipeline audit rows must name an existing actor | 4.3ag |
| A4 | Major | Role and ban changes are audited only by convention: `nabvy_auth` can write `role` and `banned` directly; `seed_founders` and Better Auth's automatic unban write no audit row | A trigger on `better_auth."user"` for `role`, `banned`, `ban_expires` and `restriction_policy` that writes the audit row, or refuses unless the audited path set a transaction flag | 4.3ag |
| A5 | Minor | `ADMIN_EMAILS` re-promotes on every sign-in, so a demoted but still-signed-in founder address becomes admin again (`services/auth/src/auth.ts:126`) | Bootstrap only while no admin exists or on first sign-in; the runbook says ban, not demote | 4.3ah |
| A6 | Minor | Better Auth's `list-user-sessions` returns tokens, IPs and user agents, and the read is not audited | Remove `session:['list']`; an audited procedure that strips the token | 4.3ah |
| A7 | Minor | The admin check in `audited()` reads only the role, so a banned admin named as actor passes | Also require `account_active(actor)` | 4.3ah |
| A8 | Minor | Audit rows can be backdated (`at` and `id` are writable) and `nabvy_app` can insert any action name | Column-level insert grants, `at = now()` forced, an allow-list of actions per role | 4.3ag |
| A9 | Minor | Founder email matching uses Unicode lowercasing (`domain/founders.ts:4`) | ASCII only after NFKC; exact comparison | 4.3ah |
| A10 | Minor | One admin can demote or ban every other admin; no last-admin guard; `reason` optional | Last-admin guard; a second approver for promotions and actions on admins; `reason` required | 4.3ah |
| A11 | Minor | Admin fixtures are returned in every environment and the module lacks `server-only` (`apps/web/src/data/index.ts:107`) | `import 'server-only'`; throw in production until the real procedure exists (H13) | 4.3af |
| A12 | Minor | The client session shows a stale admin role for up to 5 minutes after demotion | Never gate admin navigation or data on the client session; server checks already bypass the cache (H4) | 4.3af |

**Held under attack:** `requireAdmin` reads the database past the cookie cache and requires a verified, active admin. Better Auth's writing admin endpoints (set-role, ban, impersonate, set-password, remove) are refused. `role` cannot be set through input. `audited()` locks the row and writes the audit row in the same transaction. `audit_log` is append-only, even for the owner. Switch code refuses always-on switches and audits in-transaction. No seller data or secrets appear on admin pages.

**Added to the requirements:** H14, database ceilings, so a cap row cannot exceed a maximum set in a migration. H15, a second admin, or a cooling-off period, for cap raises and for actions on admins. H16, audited reads of personal data (sessions, user lookup).
