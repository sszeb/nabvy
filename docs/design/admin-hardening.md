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

## Adversarial audit

[filled after the audit of the admin code on `main`]
