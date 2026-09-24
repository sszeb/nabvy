# Account sharing — condensed design

Condensed from `docs/design/drafts/account-sharing.md` (972 lines, one-off research draft, not decisions). Covers the `account-integrity` module: device/session sharing controls, detection signals, the automatic enforcement ladder, and channel (Telegram/push/alert-link) hardening.

## One-screen summary

- **Product behaviour (on for everyone, from launch):** one live screen per account (deal feed/map/search only), with a small device cap (2–3) and a silent takeover; a visible second screen shows **"Use here"** instead of signing anyone out. Full automatic sign-out-elsewhere (the owner's original suggestion) is kept only as a *targeted* enforcement step (L1) and an optional per-plan "strict mode", not the default — it costs too much given magic-link sign-in and iOS push tied to a signed-in device.
- **Detection is entirely internal.** Signals, scores, rule IDs and evidence are never shown to any user in any channel — only four fixed notices (N1–N4) naming a policy, per the existing owner rule. Admins and developers see everything.
- **Enforcement is a 5-step automatic ladder:** L0 watch → L1 re-verify (targeted session revoke) → L2 limit (7 days: 1 device, 1 channel, lower alert cap) → L3 suspend (7 then 30 days) → L4 ban, plus a hard rule for ban-evasion key matches (email/card). Own-device-only signals (location, device count) can reach at most L1; only signals showing another person or a machine (relay-class, `evasion_match`, contested "Use here") can escalate further.
- **Channel hardening:** Telegram is private-chat-only with `protect_content`, capped re-links and group-leave-on-add; alert links never create a session, log opens, and allow only 3 distinct openers per alert before showing a sign-in wall; push is bound to a signed-in device and paused (not deleted) on an enforcement sign-out.
- **No new dependencies** beyond swapping `web-push` (MPL-2.0, disallowed) for `@pushforge/builder` (MIT). Everything else is Better Auth plugins already in the stack, plus in-house rules. No device fingerprinting in v1.
- **Rollout:** shadow (record only, ≥4 weeks) → soft (L1/L2 live, per rule) → hard (L3/L4 live, per rule), each gated on labelled precision and zero hits on a named honest-user cohort; automatic demotion on a miss.

## What the draft explicitly does not do

No UK law was researched or applied (owner instruction); legal points are listed with no analysis (section 6 of the draft, ~15 lines below). No pricing, tier names, or user-facing wording is decided here — see "Stays open" below.

## Modules it changes (one line each)

| Module | Change |
| --- | --- |
| `account-integrity` | Major expansion: owns device/session/lease state, the full signal catalogue and risk score, the L0–L4 ladder mechanics, and (new) two user-facing views for a Devices page. Currently undocumented in its card. |
| `auth` | Turn on the Email OTP plugin (code alongside every magic link, for the iOS installed app) and the Device Authorization plugin (approval from an existing device); fix `bannedUserMessage` so `banReason` never leaks; widen the captcha plugin's `endpoints` and set rate-limit `storage: "database"`. Not in the current card. |
| `account` | Telegram link/re-link hardening (unique constraints, single-use codes, established-device-only linking) and push subscriptions bound to `device_id`/`session_id`, both gated through `account-integrity.checkChannelBinding()`. Not in the current card. |
| `notifier` | Signed alert links that never authenticate, an opener allowance (3 distinct openers/7 days), open logging, key rotation, and `protect_content`/no-preview Telegram sends. Not in the current card. |
| `subscriptions` | New: calls `account-integrity.checkTrialKeys()` from the subscription-created hook so a repeat trial (same card/email/device) ends at once; optional paid extra seat ("Duo"), price and timing open. |
| `audit-log`, `usage-ledger`, `review-console` | Already cover their part (generic `record()`, `v_balances` as a fair-use input, admin queues) — no amendment needed. |

**No brand-new modules.** The draft's own "Changes other modules make" section and its events/tasks use build-pack names that no longer exist in the atomic catalogue: `notification-dispatcher` → `notifier`; `opportunity-router` → `spec-match` + `alert-router`; `crawl-planner` → `check-scheduler`; `billing-entitlements` → `subscriptions`; `hunt-manager` → `want-manager`; `marketing` → `lifecycle-messaging` (+ `marketing-consent`); `ops-monitor` → `audit-log` (for `record()`) + `ops-metrics` (for dashboards). Every task and event in the draft needs relabelling to these names before a build session reads it.

## Decisions and defaults the draft takes (engineering, not product)

- Session model: cap + one live lease with silent/`Use here` takeover, not per-tab counting (rejects the "connection count" alternative).
- A first-party device cookie, not fingerprinting, for v1; fingerprinting (MIT-licensed options only) is a fallback if shadow data shows cookie-clearing evasion.
- Revocation is event-triggered, not time-based; existing 30-day sessions are kept.
- `@pushforge/builder` (MIT) replaces the `web-push` (MPL-2.0) named in `docs/architecture.md`/`docs/secrets.md` but never installed — a licence swap, not a new capability.
- Near-real-time signals run every 5 minutes; a nightly batch computes the rest — both as Trigger.dev batch tasks over accounts, consistent with the batches rule.
- Three new secrets (`INTEGRITY_HASH_SECRET`, `DEVICE_COOKIE_SECRET`, `ALERT_LINK_SECRET`) to add to `docs/secrets.md`.

## What stays open (owner questions — the draft's "recommended defaults" are not decisions)

The draft frames these as "recommended default, applied until the owner decides" (its D1–D25). Per instructions, anything that is pricing, a tier, wording shown to users, or an enforcement threshold a user would notice is recorded here as a question, not adopted:

- **Device model and caps** (D1, D2, D4): one live screen + 2–3 device cap vs. the owner's original "always sign out elsewhere"; the exact cap per plan; the new-device allowance before approval is required.
- **Plan-limit visibility and wording** (D3, D13): whether device/live-screen/Telegram limits are shown on the pricing page and Devices page; the exact text of N1–N4, the picker, "Not me", approval screens and the Telegram linked message.
- **Telegram re-link cap** (D6) and **paid extra seat "Duo"** (D5): its existence, price and name.
- **Ladder timings** (D19): L2's fixed 7 days; L3's 7-then-30-day suspension; the 180-day repeat-ban window; 90 clean days to step back — all lengths a suspended/limited user would notice.
- **Channel-feed audience cap or per-member price** (D21) for Business.
- **Free-trial eligibility rule** (D22): one trial per card/email/device, ending a repeat trial at once and charging the first month.
- **`foreign_opener` as a ban-adjacent signal** (D23): kept at a lower weight with household/single-deal exclusions rather than a hard ban rule — an enforcement-threshold choice.
- **Location shown to users** (D24): an approximate area with a caveat in security alerts vs. town-only on the Devices page.
- **Fingerprinting** (D16) and **retention periods** (D17): privacy-adjacent, already flagged for legal review below; no data is kept beyond what's listed until the owner and a lawyer confirm periods.

## Notes for the coordinator

- No conflict with the Precedence section of `docs/decisions.md`: this draft doesn't touch the Facebook actor, seller data, or sourcing, so none of the Precedence rows apply.
- The design's whole method — "what big tech does, what caused backlash, what worked" — is exactly what "Policies match big tech" (`CLAUDE.md`) asks for; no rewrite needed there, just the owner's sign-off on the product-facing numbers above.
- The existing `account-integrity` card says "User-facing: none; the status and notice are `account`'s." The draft gives `account-integrity` two new user-facing views (`v_my_devices`, `v_my_limits`) for a Devices page, because it is the module that owns the `devices`/`sessions` tables (rule 5: a module's output is read only through its own views). This is a gap to fix, not a rules conflict — see the amendment in the integration scratchpad.
