# Audit of the atomic-module drafts: changes

Audit of 2026-09-24 over `modules.md`, `copy-advert.md` and `actor-integration.md` in this folder. Actor sources are the owner's listed files only; every `fb-scrap-engine/` citation in the three files was checked against that list and against the file's length, and every `HANDOFF.md` citation falls within lines 80–253. No claim rests on `nabvy/docs/fb-actor-reference.md`. Nabvy files are read at commit `05227ec`; `nabvy/docs/decisions.md` is unchanged since `7debf5d`, and the three files now cite it at that numbering. "Starting value" marks a threshold to calibrate; each one keeps its basis in the file that proposes it.

## Backlog changes

**IDs.** Checked against `nabvy/docs/backlog.md:9-87` (0.1–0.6, 0.5a, 1.0–1.9, 1.5a, 2.1–2.5, 3.1–3.5, 4.0–4.8, 4.1a, 4.1b, 4.3a, 4.3b, 4.5a, 4.6a–4.6c, 4.7a, 5.1–5.6, 5.3a, 5.4a). New IDs also avoid 4.1c (PR #10, `nabvy/docs/handoff.md:58`) and the account-sharing draft's 4.2a and 4.3c–4.3o (`nabvy/docs/design/drafts/account-sharing.md:800-813`). A build-pack ID is kept only where one build-pack task maps to one module ("kept"). The listing-reuse draft reuses 0.4a, 1.3a, 1.4a–1.4c, 1.5b, 1.5c, 1.6a–1.6c, 1.7a, 1.7b, 1.8a–1.8d, 1.9a and 4.1c for other tasks (`nabvy/docs/design/drafts/listing-reuse.md:157-176`); this list keeps the IDs of the three audited files, leaves 0.4a, 1.5b, 1.5c, 1.6a–1.6c and 1.8a–1.8d unused, and the coordinator renumbers the listing-reuse tasks when that draft is integrated.

**Standing definition of done for every task** (`nabvy/CLAUDE.md:22`; `modules.md:142-153`): contracts in `packages/contracts/src/modules/<module>.ts`; schema in `packages/db/src/schema/<module>.ts` with migrations in `packages/db/migrations/<module>/`; fixture tests under `services/<module>/test/fixtures/` with a recorded pass rate; the idempotency, switch and contracts tests; `pnpm typecheck && pnpm lint && pnpm test && pnpm test:fixtures && pnpm db:dry-run` clean; a switch that defaults to `off`; a README in the catalogue's template; a `docs/progress.md` row written by the coordinator. One branch `task/<id>-<module>` and one pull request per task.

**Build-pack tasks re-scoped or split.**

| Build-pack task | Becomes |
| --- | --- |
| 1.0 Document the actor | Done in part; 1.0a records the missing fixture runs |
| 1.1 Apify Facebook adapter | 1.1a–1.1f. 1.1a keeps its current meaning and running session (re-source, input validation, gateway input hardening; `nabvy/docs/questions.md:17`; `nabvy/docs/handoff.md:59`); 1.1b takes the gateway migrations of `actor-integration.md` 3.5 that 1.1a does not |
| 1.2 Crawl planner (minimal) | 1.2a, 1.2b, 1.2c, 1.2e (1.2d unused) |
| 1.3 Listing registry | 1.3a–1.3g |
| 1.4 Cheap gate and detail fetch | 1.4a–1.4d; the title gate is dropped |
| 1.5 Extraction | 0.4b (product keys), 1.5d–1.5h; 1.5a (evaluation harness) kept |
| 1.6 Price Book v0 and valuation v0 | 1.6d, 1.6e; sold-based valuation after the MVP |
| 1.7 Risk screener v0 | 1.7a–1.7g, 1.7i, 1.7j; 1.7h reserved for `multi-quantity-filter` (parked) |
| 1.8 Router and Telegram dispatcher | 1.8e–1.8l |
| 1.9 Ops monitor v0 | 1.9a–1.9f |
| 3.2, 3.3 | Kept as `scan-recognition` and `scan-lookup` (Facebook asks only in the MVP) |
| 3.4 Scan card (similar items) | After the MVP (`similar-items`) |
| 3.5 Inventory and eBay drafts | 3.5 kept as `inventory`; `ebay-drafts` after the MVP; `sold-reports` later |
| 4.0 Auth service | Kept as `auth` (PR #9 in review) |
| 4.1 Web app core | Kept as web wiring (not a module); `listing-feedback` is 4.1d, `pickup-routes` 4.1e |
| 4.1b User dashboard | Kept as a web task; no pinned map; the owner's map at town or area reference points (`nabvy/docs/decisions.md:142`) |
| 4.3 Billing | 4.3 kept as `subscriptions`; `usage-ledger` is 4.9; boosts parked |
| 4.3a Account and channels | Kept as `account`, with the standing record |
| 4.3c–4.3o (account-sharing draft) | `account-integrity`, once that draft is integrated |
| 4.4 Crawl planner v1 | Superseded by 1.2b and 1.2e |
| 4.5 Review console | Kept as `review-console` |
| 4.5a SEO price pages | After the MVP (`seo-price-pages`) |
| 4.6 Public freshness page | Kept as a web page over `app.v_ops_metrics_freshness` (1.9e) |
| 4.6b Lifecycle messaging | 4.6b kept as `lifecycle-messaging`; `marketing-consent` is 4.10 |
| 4.6c Nabvy Daily | Kept as `daily-brief`, private brief only (question 28 below) |
| 4.7 Compliance surface | Kept; `output-guard` (4.11) and `seller-rights` (4.12) added beside it |
| 4.7a Affiliate programme | Kept as `attribution` |
| 5.1 Gumtree adapter | Parked (`gumtree-adapter`) |
| 5.3, 5.4a Channel bots, public API | Back in the plan with no module owner yet (question 39 below) |

**The ordered list.** Waves follow the tasks' dependency rounds: a task starts when every task it depends on is merged. A dependency marked "(soft)" needs only the stub from 0.7. Source lines are in this folder unless marked `nabvy/`.

| # | Wave | ID | Task | Definition of done (beyond the standing items) | Depends on | Source |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 0.7 | Foundation follow-up: the `app` schema and soft-dependency stubs | A core migration creates the `app` schema and its grants to `nabvy_app`. For every soft dependency an MVP module reads before its owner merges (`seller-key`, `photo-review`, `side-discovery`, `multi-quantity-filter`, `seller-boosts`, `ebay-adapter`, `ebay-sold`, `gumtree-adapter`, `cex-adapter`, `sold-price-book`, `cross-post-links`, `opening-offer`, `part-out-calculator`, `seo-price-pages`, `seller-price-report`, `retail-comparison`; until they merge, `want-manager`, `subscriptions`, `parts-ai`, `pickup-location`, `seller-reply-reports`, `asking-price-position`, `copy-advert`): a schema, a contract file and the published views as `select … where false`, switch `off`. `view_violations()` clean | 0.2, 0.3 (done) | `modules.md:11`; `copy-advert.md:669` |
| 2 | 0 | 0.8 | `quote-redaction` | `redact()` in TypeScript and `quote_redaction.redact(text)` in SQL pass the same cases (phone, email, handle, link, inward postcode half); the recorded run's masked business postcode as a synthetic unmasked case | 0.2 (done) | `modules.md:352` |
| 3 | 0 | 1.1a | `apify-gateway`: actor input contract and run shapes | As `actor-integration.md:431` | 0.2 (done) | `actor-integration.md:431` |
| 4 | 0 | 1.1d | `cost-meter` | As `actor-integration.md:430` | 0.3 (done) | `actor-integration.md:430` |
| 5 | 0 | 1.9b | `audit-log` | As `actor-integration.md:427` | 0.3 (done) | `actor-integration.md:427` |
| 6 | 0 | 1.9c | `incidents` | As `actor-integration.md:429` | 0.3 (done) | `actor-integration.md:429` |
| 7 | 0 | 4.0 | `auth` (kept; PR #9) | Sign-up by magic link and Google; admin role check; admin bootstrap from `ADMIN_EMAILS`; generated tables never edited by hand | 0.3 (done) | `modules.md:1327`; `nabvy/docs/backlog.md:57` |
| 8 | 1 | 1.1b | `apify-gateway`: gateway migration and Edge Function | As `actor-integration.md:432` | 1.1a | `actor-integration.md:432` |
| 9 | 1 | 1.9a | `switches` | As `actor-integration.md:428`, plus `switches.state()` and `switches.is_on()` as SECURITY DEFINER functions with `EXECUTE` for `nabvy_app` | 1.9b | `actor-integration.md:428`; `copy-advert.md` 5.1 |
| 10 | 2 | 0.4b | `product-catalogue` | Every `part-patterns.json` regex compiles with the `i` flag; "OptiPlex 3090" never resolves to an RTX 3090; desktop and mobile 5080 differ; the pack's alias fixtures; seed extended from the pack dictionary | 1.9a, 1.9b | `modules.md:366` |
| 11 | 2 | 0.5a | `waitlist` (kept; blocked on the owner's accounts) | An entry lands with its UTM | 1.9a | `modules.md:1447`; `nabvy/docs/backlog.md:14` |
| 12 | 2 | 1.1c | `apify-gateway`: module package | As `actor-integration.md:433` | 1.1b, 1.1d, 1.9a | `actor-integration.md:433` |
| 13 | 2 | 4.3a | `account` (kept, re-scoped) | Link, export and delete; `standing` changed only through `setStanding()`; `isActive()`; a suspended account refused until its date; the notice names the policy only and carries no reason, rule, signal or score | 4.0, 1.9a, 1.9b | `modules.md:1342`; `nabvy/docs/backlog.md:62` |
| 14 | 3 | 1.0a | Record fixture runs (owner-approved one-offs) | As `actor-integration.md:446` | 1.1c | `actor-integration.md:446` |
| 15 | 3 | 1.1e | `route-health` module | As `actor-integration.md:437` | 1.1c | `actor-integration.md:437` |
| 16 | 3 | 1.2c | `spend-governor` | As `actor-integration.md:439` | 1.1d, 1.9a, 1.1c | `actor-integration.md:439` |
| 17 | 3 | 1.3a | `listing-ingest` | As `actor-integration.md:434`, plus the primary photo ID and `money.kind` in `v_listings` | 1.1c | `actor-integration.md:434`; `copy-advert.md:20` |
| 18 | 3 | 1.9d | `product-events` | The consent gate; the property allowlist | 1.9a, 4.3a | `modules.md:1066` |
| 19 | 3 | 3.2 | `scan-recognition` (kept, re-scoped) | EAN lookup; contract validation on fixture photos; confirmation below 0.8; a scan past the user's cap refused before any model call; vision calls off until question 11 | 0.4b, 1.1d, 4.3a, 1.9a; `cex-adapter` (soft) | `modules.md:1250`; `nabvy/docs/backlog.md:48` |
| 20 | 3 | 4.9 | `usage-ledger` (split from 4.3) | Bucket order; refusal at zero; reversal on failure; a repeated `grant()` with the same `refId` writes once | 4.0, 4.3a, 1.9a | `modules.md:1372` |
| 21 | 3 | 4.10 | `marketing-consent` (split from 4.6b) | A suppressed address is never sent to | 4.0, 4.3a, 1.9a | `modules.md:1432` |
| 22 | 4 | 1.3b | `run-coverage` | As `actor-integration.md:435`, plus bounded baselines | 1.1c, 1.3a | `actor-integration.md:435` |
| 23 | 4 | 1.3c | `detail-evidence` | As `actor-integration.md:436` | 1.1c, 1.3a | `actor-integration.md:436` |
| 24 | 4 | 1.3f | `seller-key` (gated: question 7) | The key is stable for a numeric ID; links for any other purpose refused; only the allowlist reads `restricted_listing_keys` | 1.1c, 1.3a | `modules.md:593` |
| 25 | 4 | 1.4a | `details-queue` | As `actor-integration.md:442` | 1.1c, 1.1e, 1.2c | `actor-integration.md:442` |
| 26 | 4 | 1.7j | `seller-reply-reports` | A second identical report writes nothing; no reporter ID in any view; purge on `account.deleted`; the rate limit | 1.9a, 4.0, 4.3a, 1.3a | `modules.md:1004` |
| 27 | 4 | 4.3 | `subscriptions` (kept, re-scoped; blocked on Stripe) | Entitlement matrix; webhook replay; Checkout refused without the "Start my plan now" tick; `v_billing_signals` never in a user-facing view | 4.0, 4.3a, 1.9b, 4.9 | `modules.md:1357`; `nabvy/docs/backlog.md:61` |
| 28 | 4 | 4.6b | `lifecycle-messaging` (kept, re-scoped) | Programmes fire from test events; suppressed addresses skipped | 1.9d, 4.10, 4.3a | `modules.md:1462` |
| 29 | 5 | 1.1f | `source-health` | As `actor-integration.md:440` | 1.1c, 1.1e, 1.3b | `actor-integration.md:440` |
| 30 | 5 | 1.2a | `city-pages` | As `actor-integration.md:438` | 1.3a, 1.3b, 1.9b | `actor-integration.md:438` |
| 31 | 5 | 1.3d | `listing-lifecycle` | As `actor-integration.md:445` | 1.3a, 1.3c, 1.4a | `actor-integration.md:445` |
| 32 | 5 | 1.3e | `listing-suppression` | A suppressed listing never reaches an `app` view; look-alike entries expire after 90 days; only hashes stored; `is_suppressed()` granted to `nabvy_app`; with the module off, `app.v_listing_card` returns no rows | 1.3a, 1.3c; `seller-key` (soft) | `modules.md:1019` |
| 33 | 5 | 1.3g | `relist-merge` | Every merged group checked by hand in a backtest; the PC 4070 median case as a synthetic index case | 1.3a, 1.3c; `photo-review`, `seller-key` (soft) | `modules.md:730` |
| 34 | 5 | 1.5d | `parts-rules` | The labelled set of about 100 PC descriptions scored per field; "GDDR7" is not system RAM; the Legion desktop; `+`-encoded text | 1.3a, 1.3c, 0.4b | `modules.md:625` |
| 35 | 5 | 4.7a | `attribution` (kept) | Lead once per user; sale once per invoice; a chargeback or legally required refund reverses | 4.0, 4.3a, 4.3, 4.9 | `modules.md:1387`; `nabvy/docs/backlog.md:72` |
| 36 | 6 | 1.2b | `search-planner` | As `actor-integration.md:441` | 1.2a, 1.9b; `want-manager` (soft) | `actor-integration.md:441` |
| 37 | 6 | 1.4b | `details-selector` | As `actor-integration.md:444` | 1.3a, 1.2a, 1.4a; `want-manager` (soft) | `actor-integration.md:444` |
| 38 | 6 | 1.5e | `parts-ai` (ships off: question 11) | Schema validation; a quote not in the text is rejected; a listing whose text instructs the model; a cache hit on the same evidence hash; a weakened prompt fails the evaluation run | 1.5d, 1.3c, 0.4b, 1.2c, 1.1d, 1.4a, 0.8 | `modules.md:640` |
| 39 | 6 | 1.5f | `parts-record` | The two worked examples as synthetic fixtures; the recorded inclusion cases | 1.5d, 0.4b; `parts-ai`, `photo-review` (soft) | `modules.md:670` |
| 40 | 6 | 1.7a | `copy-advert` core, in shadow | As `copy-advert.md:650` | 1.9a, 1.9b, 1.3a, 1.3c, 1.4a, 1.2a, 1.3e, 4.3a; `seller-key`, `photo-review` (soft) | `copy-advert.md:650` |
| 41 | 6 | 1.8f | `location` | The recorded run's distances from Facebook's reported centre; the city-page fallback; rounding | 1.2a | `modules.md:443` |
| 42 | 6 | 1.8h | `listing-card` | The exact column list; a suppressed listing never appears; titles masked; the stale-fallback flag; no coordinates; no image column while `listing-photos` is off | 1.3a, 1.3c, 1.3d, 1.3e, 0.8 | `modules.md:882` |
| 43 | 6 | 1.8i | `price-drop-watch` | The history view never joins across listing IDs; an unchanged price gives no alert; the displayed previous price is the seller's figure only | 1.3a, 1.3d, 1.3g, 1.3e, 4.0, 4.3a | `modules.md:897` |
| 44 | 6 | 4.1d | `listing-feedback` | A user cannot read another's verdicts; `v_verdict_counts` has no user ID; a repeat verdict writes one row; purge on deletion | 4.0, 4.3a, 1.3e | `modules.md:972` |
| 45 | 7 | 1.2e | `check-scheduler` | As `actor-integration.md:443` | 1.1c, 1.2b, 1.2c, 1.1f, 1.3a, 1.3b | `actor-integration.md:443` |
| 46 | 7 | 1.4c | `pasted-link-lookup` | As `actor-integration.md:447` | 1.4a, 1.8h, 1.3e, 4.0, 4.3a | `actor-integration.md:447` |
| 47 | 7 | 1.5g | `listing-assessment` | "RTX 4090 not included" demoted; a complete system titled "OFFERS" is a container; a container with no GPU is "not stated"; a photo-only positive marked so | 1.5f, 1.3c, 1.3a | `modules.md:685` |
| 48 | 7 | 1.5h | `pickup-location` (AI step off: question 11) | "Collection from Bognor" under a Chichester field resolves with a conflict; no postcode or street in any view; the town fallback; replay writes nothing | 1.3a, 1.3c, 1.2a, 1.8f, 0.8, 1.2c, 1.1d, 1.3e | `modules.md:835` |
| 49 | 7 | 1.8e | `want-manager` | A user cannot read another's wants; the aggregate views, `v_want_areas` included, carry no user IDs; postcode resolution | 1.8f, 0.4b, 4.0, 4.3a; `subscriptions` (soft) | `modules.md:852` |
| 50 | 7 | 3.5 | `inventory` (kept, re-scoped) | Outcome write; row-level security | 4.0, 3.2, 1.8h, 4.3a | `modules.md:1295` |
| 51 | 7 | 4.1e | `pickup-routes` | A user cannot read another's pickups; no view over `pickups`; purge on deletion | 4.0, 4.3a, 1.8f | `modules.md:987` |
| 52 | 8 | 1.4d | `photo-review` (gated: actor photo capture, question 11) | The photo gold set once the owner approves actor test T4; bytes deleted after the verdict; the expired-link path | 1.5d, 1.5e, 1.8e, 1.3c, 1.4a, 1.2c, 1.1d, 1.1c | `modules.md:655` |
| 53 | 8 | 1.7b | `copy-advert` backtest and calibration | As `copy-advert.md:651` | 1.7a; 1.2e (the test hunt's live checks); question 29 for the control run | `copy-advert.md:651` |
| 54 | 8 | 1.7e | `noise-filter` | The 14 "5080" mentions; recorded rows 11, 12, 14 and 20; buyer adverts added on purpose; no false wanted or empty-box hits | 1.5g, 1.5f, 1.5d, 1.3a, 1.3c, 1.3e | `modules.md:700` |
| 55 | 8 | 1.7i | `demand-signals` (built once first-party wants exist: question 17) | Suppression below the threshold; no user ID in any output; a copied wanted advert counts once | 1.8e, 1.5g, 1.2a; `copy-advert` (soft) | `modules.md:805` |
| 56 | 8 | 1.8k | `prepared-message` | An unstated GPU becomes a question; no seller data; no send path | 1.5g, 0.8 | `modules.md:927` |
| 57 | 9 | 1.6d | `asking-price-index` | Split-half stability at n≥10; the worked example's groups; relist and copy collapse; EUR kept apart; "copy collapse unavailable" while `copy-advert` is off | 1.5f, 1.5g, 1.3c, 1.3a, 1.3g, 1.7a, 1.7e, 1.2a, 1.3e; `seller-key`, `seller-boosts` (soft) | `modules.md:745` |
| 58 | 9 | 1.7d | `copy-advert` optional evidence (gated) | As `copy-advert.md:653` | 1.7a, 1.3f, 1.4d | `copy-advert.md:653` |
| 59 | 9 | 1.8g | `spec-match` | The RTX 5080 and "Pc" worked examples; ten real wants over stored data; an unstated GPU never `no_match`; the owner's filters and sorts; hints in shadow only | 1.8e, 1.5f, 1.5g, 1.7e, 1.3a, 1.8f, 1.7a, 1.3e, 0.8, 4.3a; `multi-quantity-filter`, `pickup-location`, `asking-price-position` (soft) | `modules.md:867` |
| 60 | 10 | 1.6e | `asking-price-position` | The worked example at n=12 and the hidden n=6 case; no row below n=10 | 1.6d, 1.5g, 1.5f, 1.3c, 1.3a, 1.3e | `modules.md:760` |
| 61 | 10 | 1.7f | `warning-signs` | Each rule on positive and negative cases, including postage-only on a collection listing; a cheap ask explained by fault wording not flagged | 1.3c, 1.5g, 1.6d, 1.3a, 1.3e, 0.8 | `modules.md:775` |
| 62 | 10 | 1.8j | `alert-router` | One alert per copy cluster and per relisted item; photo-only positives to the digest; the rate limit; silence at the baseline, bounded baselines included | 1.8g, 1.8i, 1.7a, 1.3g, 1.5g, 1.8e, 1.3e, 1.3d, 1.3b, 4.3a; `subscriptions` (soft) | `modules.md:912` |
| 63 | 10 | 3.3 | `scan-lookup` (kept, re-scoped) | With every other source off, a scan shows the asking-price position or "not enough asks"; cached scan under 2 s | 3.2, 1.6d, 4.9, 4.3a; eBay, CeX and sold-price modules (soft) | `modules.md:1265`; `nabvy/docs/backlog.md:49` |
| 64 | 11 | 1.7g | `suspected-labels` | No label without evidence; every label starts "Suspected"; the trade-seller case from recorded row 11 in shadow; "too good to be true" candidates from each listing signal, in shadow | 1.7f, 1.7a, 1.7e, 1.3c, 1.3e, 1.9b; `pickup-location`, `seller-reply-reports` (soft) | `modules.md:790` |
| 65 | 12 | 1.8l | `notifier` | The claim written before the send; `unknown` never retried; no seller field or location finer than town; freshness from the exact `listedAt` | 1.8j, 1.8h, 4.3a, 1.8g, 1.8i, 1.6e, 1.7f, 1.7g, 1.7a, 1.8k, 0.8, 1.3e, 1.8f; `pickup-location` (soft) | `modules.md:942` |
| 66 | 13 | 1.10 | rtx3090 end-to-end acceptance | As `actor-integration.md:448` | 1.2e, 1.4b, 1.3d, 1.7a, 1.5d, 1.5f, 1.5g, 1.7e, 1.6d, 1.6e, 1.8g, 1.8j, 1.8l, 1.9a, 1.9b, 1.8e, 0.4b, 1.8f, 0.8, 1.8h, 1.3e, 1.3g, 1.8i, 1.7f, 1.7g, 1.8k, 4.3a | `actor-integration.md:448` |
| 67 | 13 | 1.9e | `ops-metrics` | Rollup arithmetic on synthetic stamps; copy-advert shadow metrics carry no account data | 1.3a, 1.4b, 1.5g, 1.6e, 1.8g, 1.8l, 1.1d, 1.9d, 1.9c, 1.3b, 4.1d, 1.7a | `modules.md:1081` |
| 68 | 13 | 1.9f | `ops-alerts` | Each rule fires once per key; no repeat within its window | 1.2c, 1.1f, 1.1e, 1.9c, 1.3a, 1.1c, 1.8l, 4.3 | `modules.md:1096` |
| 69 | 13 | 4.3c–4.3l | `account-integrity` (the account-sharing draft's tasks) | The catalogue card's tests, merged with the draft's; ships in shadow | 4.0, 4.3a, 4.3, 4.9, 1.9d, 1.8e, 1.8j, 1.4c, 1.8l, 1.9b | `modules.md:1402`; `nabvy/docs/design/drafts/account-sharing.md:801-810` |
| 70 | 13 | 4.6c | `daily-brief` (kept, re-scoped) | A user with nothing new gets nothing; private brief only; no score, fair value or margin | 1.8g, 4.10, 1.8l, 1.8h, 1.6e; `sold-price-book`, `cex-adapter` (soft) | `modules.md:1477`; `nabvy/docs/backlog.md:71` |
| 71 | 13 | 4.12 | `seller-rights` | After erasure only hashes remain; every `erase()` idempotent; suppression applies before erasure finishes | 1.3e, 1.9b, 1.1c and every listing-holding module above | `modules.md:1034` |
| 72 | 14 | 4.5 | `review-console` (kept) | A correction reaches the owning module, including `copy-advert.applyCorrection()`, and adds a fixture | 1.5e, 1.5d, 1.5f, 1.5g, 1.7g, 1.7a, 1.8l, 1.9b, 4.3c, 4.1d | `modules.md:1111`; `nabvy/docs/backlog.md:65` |
| 73 | 14 | 4.11 | `output-guard` | Deliberately bad views and cards fail it, map markers and postcodes included | Every module whose `app.` view it checks (`modules.md:1057`) | `modules.md:1049` |
| 74 | 15 | 1.7c | `copy-advert` user-facing flag | As `copy-advert.md:652` | 1.7b, 4.11, 1.3e, 0.7; 4.5 or an admin procedure | `copy-advert.md:652` |

**[CHECK-IN]** after 1.10 (`actor-integration.md:450`), and after 1.7b before 1.7c (`copy-advert.md:651-652`).

**Not scheduled in this push:** `ebay-adapter`, `ebay-sold`, `cex-adapter`, `gumtree-adapter`, `cross-post-links`, `sold-price-book`, `valuation`, `similar-items`, `ebay-drafts`, `seo-price-pages` (after the MVP); `side-discovery` and the nine "Later" modules; `boosts`, `multi-quantity-filter` (1.7h reserved) and `fake-door` (parked) (`modules.md:171-177`). Their stubs come from 0.7 where an MVP module reads them.

**Sequencing notes for the coordinator.**
- `output-guard` lists hard dependencies on every module it checks, including `account-integrity`, which needs `subscriptions` (blocked on Stripe). 1.7c therefore waits for billing unless `output-guard`'s per-module checks become soft; that is a design choice for the coordinator.
- The handoff names a running 1.1a session for gateway input hardening (`nabvy/docs/handoff.md:59`); 1.1b must not repeat its migrations.
- PR #9 (4.0) builds "the account standing check" in `auth` (`nabvy/docs/progress.md:35`), while the catalogue gives standing to `account` and the account-sharing draft puts `account_status` in `account-integrity` (`nabvy/docs/design/drafts/account-sharing.md:801`). One owner must be chosen before 4.3a and 4.3c merge.

## Precedence rows to add

Rows for `nabvy/docs/decisions.md` "Precedence" (`nabvy/docs/decisions.md:9-26`) that the three files rely on and the table does not hold. An agent does not edit that file (`nabvy/docs/decisions.md:3`); the owner records them.

| Topic | Build pack says | Brief says (wins) |
| --- | --- | --- |
| Noise and wanted adverts | Wanted, laptop and accessory words are title excludes at the gate (`nabvy/docs/packs/gpu-pc.md:12`); screen flags are shown, never used to hide silently (`nabvy/docs/architecture.md:66`) | A free noise filter hides wanted, swap and "I buy" adverts, keyword stuffing, laptops and mention-only hits (`fb-scrap-engine/docs/HANDOFF.md:171-173`). Meanwhile hidden with a visible count and a "show hidden" switch (`modules.md` question 17) |
| Detail selection | A pack title gate chooses candidates; details in batches of 20–50 (`nabvy/docs/backlog.md:25`) | Every new ID in area or shipped, whatever its price or title, gets details; batches of up to about 200 (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:67-68,108-109,164-166`) |
| Content hash | `contentHash` = sha256 of title, price and thumbnail URL (`nabvy/docs/engineering.md:35`) | Interpretation is versioned by an evidence hash from an allowlist (title, description, attributes, detail sections, condition, category); price, availability and location stay out, or 88% of repeat sightings would re-run AI (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:127-131`; `fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:249`) |
| Copies and relists in counts and alerts | Dedupe per user, listing and cross-post group (`nabvy/docs/modules.md:72`); no rule for copies or relists in price data | Each copy-advert cluster and each relisted item counts once in asking-price bands and gets one alert; relist alerts are dropped silently (`fb-scrap-engine/docs/design/SELLER_DATA.md:95-97,145-146`) |
| Matching wants | Hunts match product keys (`nabvy/docs/contracts.md:93-99`; `nabvy/docs/modules.md:69-72`) | Spec search and alerts match parts inside PCs, from the description too; silence is never a "no" ("GPU not stated — ask the seller") (`fb-scrap-engine/docs/HANDOFF.md:168-170`) |
| New listings and coverage | A high-water mark per watch detects new listings (`nabvy/docs/backlog.md:24`) | The app detects new IDs itself; a degraded search is rerun and never read as "nothing new"; photo-only positives go to the digest (`fb-scrap-engine/docs/HANDOFF.md:146-147`; `fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:181-182,189-192`) |

## Build-pack edits by document

**`CLAUDE.md`**
- `:10`: Facebook is reached only through the `apify-gateway` Edge Function and module, not "the Apify client and the provider adapter contract" (`actor-integration.md:396`).
- `:12`: fold the supersession into the rule: raw rows kept whole in `apify_gateway`, retention unset (`actor-integration.md:396`).
- `:24`: add the actor's batch limit, at most 200 IDs per details run (`actor-integration.md:396`).
- `:59`: if the owner approves `copy-advert` change 1, note that rule thresholds may live with the rule version in `src/domain/rules.ts` (`copy-advert.md:17`).

**`docs/decisions.md`** (the owner records these; no agent edit, `nabvy/docs/decisions.md:3`)
- Adoption of the catalogue, the copy-advert design and the integration plan (owner decision 1 below).
- The six Precedence rows above.
- Whether to restate the cadence rule (`:221`) in centres × terms under the $150 monthly cap (`actor-integration.md:397`).
- The owner's sign-off on the copy-advert flag's wording, threshold and hide default, when given (`copy-advert.md:652`).

**`docs/architecture.md`**
- `:3,7`: hunt-driven centres × terms replace "one watch per marketplace, category and cell" (`actor-integration.md:398`).
- `:34-53`: the module table from the catalogue (`modules.md` question 1).
- `:59-72`: the alert flow of `actor-integration.md` section 2: no snapshots, no title gate, detail batches up to 200, no vanished-means-sold loop (`actor-integration.md:398`).
- `:66`: noise hits hidden with a visible count, per the new Precedence row (`modules.md` question 17).
- `:78`: no per-scan Facebook fetch (`actor-integration.md:398`).
- `:86-88`: T0 exact for Facebook; T1 is the run's `collectedAt`; T2 is "selected for details" (`actor-integration.md:398`).
- `:100-101`: no fail-over actor, no snapshots, no seller hashing, go-live gate lifted (`actor-integration.md:398`).

**`docs/backlog.md`**
- Add the tasks of the ordered list above; mark 1.1–1.9, 3.5, 4.3, 4.4 and 4.6b as split or superseded per the re-scoping table (`actor-integration.md:399`; `copy-advert.md:639`).
- 1.1's definition of done (`:22`: snapshots, seller hashing, "a live smoke test on one cell") is replaced by 1.1a–1.1f (`actor-integration.md:399`).
- 4.1b: no pinned map; the owner's map at town or area reference points (`modules.md` question 39, answered).

**`docs/billing.md`**
- `:43,64`: boosts parked (`modules.md` question 29).

**`docs/compliance.md`**
- `:7,9`: keep everything, retention unset, photo bytes deleted after review (`actor-integration.md:400`).
- `:26`: gate lifted; points listed in `docs/legal-review.md` (`actor-integration.md:400`).

**`docs/contracts.md`**
- `:3,31`: no `cellId`; `:25`: currency `GBP | EUR`; `:28`: no `sellerHash`; `:32`: card hash and evidence hash replace `contentHash` (`actor-integration.md:401`).
- `:101-106`: `CrawlUnit` replaced by plan terms and schedule (`actor-integration.md:401`).
- `:112`: `Alert.userVerdict` moves to `listing-feedback` (`modules.md:972`).
- `:124-125`: the referral and affiliate fields of `UserProfile` move to `attribution` (`modules.md:1342`).
- `:141-161`: events renamed `<module>.<what happened>` per the catalogue (`modules.md` rule 7, question 1).
- `:163-186`: tables by owner from the catalogue (`modules.md` question 1; `actor-integration.md` 3.2).
- `:192`: no snapshot retention job (`actor-integration.md:401`).
- `:198-212`: for Facebook the adapter is `apify-gateway`, submit then collect; no secondary adapter (`modules.md` question 7; `actor-integration.md:401`).

**`docs/dashboards.md`**
- `:10`: map markers at town or area level, clustered; `mv_user_dashboard` dropped (`actor-integration.md:402`; `modules.md:2115`).
- `:25`: the "cell map" becomes centres, active pairs, coverage and route state (`actor-integration.md:402`).

**`docs/engineering.md`**
- `:15`: thresholds per module in `packages/config/src/modules/<module>.ts`, or with the rule version if the owner approves `copy-advert` change 1 (`modules.md` rule 14).
- `:25-26`: per-module roles are not built; writes run inside `withPipeline` (`modules.md` rule 4, question 2).
- `:29`: migrations per module in `packages/db/migrations/<module>/` (`modules.md` rule 2).
- `:34`: city-page centres, not H3 (`actor-integration.md:403`).
- `:35-36`: card and evidence hashes; seller key only after the DPIA (`actor-integration.md:403`; `modules.md` rule 8).
- `:37-38`: photo fingerprints and embeddings wait for photo capture (`actor-integration.md:403`).
- `:43`: schedule names (`check-scheduler` tick, `apify-gateway-watch`, `recheck-tick`, `copy-advert-expire`) (`actor-integration.md:403`; `copy-advert.md:479`).
- `:44`: Facebook calls go through the gateway; one details run at a time (`actor-integration.md:403`).
- `:50`: error codes `<module>.<code>` in each module's contract file, not one shared enum (`modules.md` rule 3).
- `:56`: settled cost read at least 10 minutes after a run, not `usageTotalUsd` at finish (`actor-integration.md:403`).
- `:63`: no `snapshots` bucket for actor data (`actor-integration.md:403`).

**`docs/fb-actor-sources.md`**
- `:20-22,32-34`: the integration guide and copy-advert design are Nabvy's own documents once adopted (`actor-integration.md:414`).

**`docs/legal-review.md`** (one line each, no analysis)
- The copy-advert flag shown to users ("Likely spam: …" or "Suspected copy advert: …") (`copy-advert.md:693`).
- User reports counted on a listing's copies (`copy-advert.md:693`; `nabvy/docs/decisions.md:156`).
- A data processing agreement and transfer cover before listing text or photos reach a model (`modules.md` question 12; `fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:357-358`).
- Suspected fraud tied to a person as criminal-offence data, and automated holds (`modules.md` question 16; `fb-scrap-engine/docs/design/SELLER_DATA.md:194-198`).
- Tracking sellers over time with the internal seller key, and an EU representative for Irish sellers (`modules.md` question 9; `fb-scrap-engine/docs/design/SELLER_DATA.md:122-129`).
- Full postcodes or streets from listing text used internally to resolve pickup locations (`modules.md:835`; `nabvy/docs/decisions.md:153`).

**`docs/marketing.md`**
- `:43`: the private brief lists new matches newest first; no deal score, fair value or margin (`modules.md:1477`, question 30).

**`docs/modules.md`**
- Replaced by the catalogue once approved (`modules.md` question 1).

**`docs/operations.md`**
- `:11`: GBP only for the beta, EUR paths kept; `:15`: merge smoke test uses a free `collect` job; `:21`: founder alerts add route switches, the degraded rate and 80% of the monthly cap; `:26`: no fallback actor (`actor-integration.md:405`).

**`docs/packs/gpu-pc.md`**
- `:12`: wanted and box-only become `noise-filter` reasons, not gate excludes; `:14`: `detailFetchAll` replaced by the selector's rule; `:42-43,45`: the seller-derived rules removed (`actor-integration.md:406`).

**`docs/progress.md`**
- `:14`: 1.0's blockers are answered; `:15`: 1.1 split into 1.1a–1.1f; `:69`: the designs' row (`actor-integration.md:415`).
- A row per new task in the ordered list (coordinator, `nabvy/docs/decisions.md:77`).

**`docs/providers.md`**
- `:7-11,22-24`: the Facebook section rewritten: gateway only, asynchronous runs, v3 inputs, exact `listedAt`, up to 100 pages, no fallback actor, monthly cap (`actor-integration.md:407`).

**`docs/questions.md`**
- Add the owner decisions below that are not already open there.

**`docs/scan-mode.md`**
- `:13`: the on-demand fetch never includes Facebook (`actor-integration.md:408`).

**`docs/secrets.md`**
- `:12`: `APIFY_TOKEN` is an Edge Function secret read only by the gateway; `:14`: remove `APIFY_FB_ACTOR_FALLBACK_ID`; `:15`: `APIFY_GUMTREE_ACTOR_ID` parked; `:32`: `SELLER_HASH_SALT` becomes the seller-key HMAC secret, where it is held recorded when built; `:37`: `USD_GBP_RATE` read by `cost-meter`; `:44`: `FB_DAILY_CAP_MINOR` becomes the spend governor's monthly budget; a Trigger.dev key only if option B2 is chosen (`actor-integration.md:409`; `modules.md:593`).

**`docs/valuation.md`**
- `:17`: `ask_based` replaced by asking-price position; `:32`: no lifecycle fallback from Facebook disappearances (`actor-integration.md:410`).

**`docs/web-app.md`**
- `:30`: the card shows asking-price position, not a fair-value range; `:46`: no "Facebook …" line in the scan progress (`actor-integration.md:411`).

**`supabase/README.md`**
- `:9-13`: the gateway is the `apify-gateway` module; `:45-52`: monthly cap; a note re-sourcing the redaction v2 migration's comment (`actor-integration.md:412`).

**`services/source-adapters/README.md`**
- Split into the `apify-gateway`, `listing-ingest` and `detail-evidence` READMEs, re-sourcing claims that rested on the old reference (task 1.1a; `actor-integration.md:413`).

**Design drafts** (`nabvy/docs/design/drafts/`)
- `modules.md`: replace with the audited version; it is still the pre-audit draft (identical to `.audit/modules.orig.md`).
- `copy-advert.md` and `actor-integration.md`: commit the audited versions.
- `listing-reuse.md`: renumber its tasks (see "IDs" above); its `listing-location` module is this catalogue's `pickup-location` (one name to choose); its `gem-finder` and `similar-picks` answer owner decision 38 below if approved.
- `account-sharing.md`: use the catalogue's module names (`notifier` for `notification-dispatcher`, `subscriptions` and `usage-ledger` for `billing-entitlements`, `account`) and settle who owns the account's status.

## Owner decisions needed

Deduplicated from `modules.md` questions 1–43, `copy-advert.md` questions 1–12 and `actor-integration.md` questions 1–20. Answered since the drafts: collection gates (`modules.md` question 8), the alert gate (question 25) and the map (question 39), all by `nabvy/docs/decisions.md:131-180`. Each item gives the option taken meanwhile.

| # | Decision | Conservative option meanwhile | From |
| --- | --- | --- | --- |
| 1 | Approve the catalogue, the copy-advert design and the integration plan | Nothing module-specific is built; the foundation follow-up (0.7) and the designs go ahead; wave 1 waits (`nabvy/docs/handoff.md:115`) | M1; C1; A1 |
| 2 | One schema and one database role per module, with `withModule` | Per-module schemas as built; writes through `withPipeline`; a conventions test limits view readers | M2 |
| 3 | `contentHash` per stage: card hash on the primary photo ID, evidence hash for interpretation | Interpretation on the evidence hash; the card-hash change waits for a second recorded run | M3; A15 |
| 4 | One card observation per sighting, or only changes | One light row per sighting | M4; A15 |
| 5 | One details run at a time, or parallel runs with a lease | One at a time; the lease built anyway | M5; A15 |
| 6 | Detail batch size, run shapes and the gateway's stricter input rules as Nabvy policy | At most 200 IDs per run; the shapes of `actor-integration.md` 2.3; rules that refuse more, never less, built in 1.1b; GB proxy only | M6; A11 |
| 7 | Build `seller-key`, and with it the "spans accounts" check | Off; readers carry on without keys; sellers told future listings can be hidden only by look-alike match | M9; A14; C11 |
| 8 | Logged reads of seller data | Read-all role for developers; each session logged with a reason | M10 |
| 9 | Contact details in text sent to a model | Stored unredacted; the model copy masked by `quote-redaction` | M11 |
| 10 | The adapter contract for Facebook | `apify-gateway` is the Facebook adapter (submit, then collect) | M7 |
| 11 | An AI processor agreement (not among the lifted gates) | `parts-ai`, `photo-review` and `pickup-location`'s AI step off; scans identify by barcode and catalogue code only | M12 |
| 12 | Parts AI on an edited description | Once per listing; a later version gets rules only | A20 |
| 13 | What listing content users see | Facts, short redacted quotes and the listing link; no full description; photos off | M13 |
| 14 | Inclusion statuses | The union of both sets; only "included" counts as a match | M14 |
| 15 | The copy-advert flag: wording (A or B), which count is shown, `flagMinTowns` (proposal 5), a days limit, "hide" default, the control texts and report reasons, and confirmation of the legal review | Shadow only; nothing shown; hide off by default; drafts use B | M15; C2; C3; C4; C5 |
| 16 | Suspected labels: which types ship and their wording, including the final text of "Suspected too good to be true:" | Every label in shadow; nothing shown before legal review; no alert held because of a label | M16; A18 |
| 17 | Demand signals: cells under 5 or under 10; "Also" or "Later" | Suppress under 10; build only after first-party wants exist; nothing shown to users | M20 |
| 18 | Noise filter: hide or label | Hidden with a visible count and a "show hidden" switch | M17 |
| 19 | Warning signs shown to users | Computed in shadow until the wording is approved; price-cut facts held back | M18 |
| 20 | Asking-price position threshold | Shown only at n≥10 | M19; `nabvy/docs/questions.md:8` |
| 21 | Price-drop watch: what counts as a drop, suggested watch prices, relisted items | Any fall in a watched listing's ask; no suggested prices; a watch never moves to another listing ID | M21 |
| 22 | Build the multi-quantity filter | Not built | M22 |
| 23 | Retention of raw rows, seller keys and links, relist links, the copy-advert text, links and reports | Everything kept, except photo bytes after review; `erase()` always honoured | M23; C12; A15 |
| 24 | Erasure under the keep-everything decision | A verified request carried out in every module, keeping only hashes | M24 |
| 25 | Channel order for users | The founder's Telegram only | M26 |
| 26 | What each paid tier promises | Every feature on every tier; no plan sold on speed | M27 |
| 27 | Scores and margins | None for Facebook asks; `valuation` internal | M28 |
| 28 | Public pages with Facebook data, and the private brief's order | No public page carries Facebook listings; the personal section newest first | M30 |
| 29 | Paid capture runs: the brief's acceptance listings, a non-hardware control run (about $0.34–0.36) and the fixture runs of 1.0a | Synthetic cases, marked so; no capture run until approved | M32; C7; A13 |
| 30 | How Gumtree is reached | Parked until after the MVP | M31 |
| 31 | The largest radius a user may choose | Each want's radius; 100 km from the centre where none is set | M33; A17 |
| 32 | Actor builds Nabvy would use: photo capture, embedded cards and related terms, the missing vocabularies; the photo model provider | Planned without them; `photo-review` and `side-discovery` off | M34; A12 |
| 33 | Wording shown to users ("not stated — ask the seller", labels, the prepared message, "not covered yet", what throttled users are told) | The brief's example wording, in shadow and founder-only surfaces | M35; A4; A7 |
| 34 | When to start the "Later" modules | None built | M36 |
| 35 | Fair-use rules for `account-integrity`, and whether ban-evasion keys survive deletion | Ships in shadow; no standing changes; evasion keys kept as hashes | M37 |
| 36 | Other internal uses of seller data | The allowlist in rule 6 only | M38 |
| 37 | Is a pasted-link lookup a metered "live on-demand lookup" | Not charged; rate-limited per user | M40 |
| 38 | Gems and "also found" alternatives: which module owns them, and the "Top pick" wording | Nothing shown as a pick; matching across hunts works already | M41 |
| 39 | Owners and timing for the Business export, channel feeds and public API | Not scheduled in wave 1; seller data never in them | M42 |
| 40 | The one-tap report codes, their wording, and what makes an account "established" | The owner's three example codes in shadow only; a starting rule for "established" calibrated in shadow | M43 |
| 41 | How reports spread across a listing's copies | A copy shows the mark only with a signal of its own, computed in shadow first | C8 |
| 42 | Internal copy collapse while `copy-advert` is in shadow | Description-confirmed clusters only, each hand-checked | C6 |
| 43 | Precision and recall targets before `copy-advert` leaves shadow | Cluster precision ≥95%, no false flag in at least 30 hand-checked clusters, recall ≥80% (starting values) | C9 |
| 44 | Text copies (same description, different title or price) | Internal evidence only | C10 |
| 45 | The test hunt's terms | "3090" and "gaming pc" | A2 |
| 46 | Cadence before actor test T2, and broad terms' newest checks against more sweeps | Every 30 minutes, 07:00–23:00 UK time, a nightly sweep, catch-up off | A3 |
| 47 | How to favour paying subscribers within $150 | The throttle order `slow-free`, `slow-paid`, `slow-sweeps`, `hold-new` | A4 |
| 48 | Receiving the actor's test results | Cadences and the 80–100 km spacing stay starting values; no actor test run without approval | A5 |
| 49 | Shipped listings from outside the area | Detailed only when a want at that centre accepts delivery | A6 |
| 50 | Hunts where the seed has no centre | The hunt waits, marked "not covered yet" | A7 |
| 51 | Run completion: poll or push | Poll every minute; no new secret | A8 |
| 52 | Deleting Apify run storage after collection | Delete after a 24-hour grace period, behind a flag the owner can stop | A9 |
| 53 | Moving the build pin | 1.0.82 until a recorded run on a new build passes and the owner approves | A10 |
| 54 | Worth-the-trip hints: travel cost, margin and wording | No hint shown; differences computed in shadow; margin 0 km for detail selection | A16 |
| 55 | Raising the Apify account's usage and proxy limits to cover $150 | $85 a month and 10 GB are the working ceilings | A19 |
| 56 | Restating the cadence rule in centres × terms under the $150 cap | The rule stands, read through the Precedence row "Cadence and tiers" | A section 5 |
| 57 | Route-health and listings without a description | The helper ported unchanged; the subtraction a separate change once agreed | A15; `nabvy/docs/questions.md:12` |
| 58 | Thresholds with the rule version in `src/domain/rules.ts` instead of `packages/config` (a coordinator confirmation) | Built as the design says; the departure recorded in the module README | C change 1 |

"M", "C" and "A" are the question numbers of `modules.md`, `copy-advert.md` and `actor-integration.md`.
