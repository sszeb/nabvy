# Coordinator handoff

**For the owner.** The first coordinator session, `session_012J8dDJ1GUtySk77vK6SNjM`, handed off to a fresh one at about 11:20 UTC on 2026-09-24 because its context had grown large. It did this under your rule in `CLAUDE.md`, "Short sessions: hand off on your own". The old session now only commits the design drafts still being written as each one finishes. Follow the new coordinator from here.

**Coordinator 3 (from 12:50 UTC).** Coordinator 2 (`session_01XSTcLZmm35nVGEa6LhMoUj`) handed off at 434k tokens. Start here: (1) `git fetch origin claude/coordinator-2` and base your branch `claude/coordinator-3` on it (PR #12 is still open from `claude/coordinator-2`; keep pushing docs there until it merges, then use your own branch); (2) re-create the two-hour sweep with `send_later` for about 14:40 UTC, prompt as in "Next steps" step 1; (3) subscribe to PR #12 and to each wave-1 PR as it opens; (4) follow "Wave 1" below. The PR watchdog Routine `trig_011fjd2grZBEWR3FqfDzTWJR` is fresh-session and stays as is. Coordinator 3 is `session_01MDEFeMG2eAjgFNVvtDQcFi`; its next sweep is `trig_01NZbY3KYGnPZp8geppX9eHN` (14:40 UTC). At 12:50 it merged `main` into `claude/coordinator-2` (PR #12 conflicted in `docs/questions.md`; both sides kept). At 13:00, on coordinator 1's note, it merged `origin/claude/hopeful-wright-r5ygps` (the final audited catalogue and five drafts), regenerated the cards (89 modules, rounds 0 to 14) and republished the catalogue page (version 2). Brief round 1 onwards only from these cards; tiers are in the page (top for 41 modules, including the new `pickup-location`).

**Coordinator 4 (from 14:45 UTC).** Coordinator 3 (`session_01MDEFeMG2eAjgFNVvtDQcFi`) handed off at 505k tokens. The owner asked for this coordinator to run on Fable with ultracode on (the owner switches ultracode on; `create_session` cannot). Coordinator 4 is `session_01J54KB3jMEbsKWFKDWZG4aB`; its sweep is `trig_015YpynnaL3BUhPhBqoycTbg` (16:40 UTC). Done by 14:50: steps 1 to 4 below; #17 merged (`f4ded65`) and both quote-redaction migrations applied (ledger checked); the reviewer was pointed at #24 as the cost-meter timeout fix that unblocks #23. Start here:
1. `git fetch origin claude/coordinator-3` and base `claude/coordinator-4` on it. PR #25 merged 14:53 (`1727607`); coordinator 4 works on `claude/coordinator-4`. Open at 15:35: #28 0.10 (changes needed) and #30 (this branch, docs). Round 2 running: product-catalogue, apify-gateway, waitlist, account (IDs in `docs/progress.md`).
2. Re-create the two-hour sweep with `send_later` for about 16:40 UTC ("Next steps" step 1) and record its ID here. Coordinator 3 deleted its own.
3. Subscribe to the open PRs: #17 quote-redaction, #19 incidents, #23 switches, #24 0.9b, #25, and each new one.
4. **Fleet (14:45).** Reviewer 5 `session_017YE3cbW8uLkFpu1gcByZyn` (from 15:15; reviewer 4 `session_01X3MfLzncUgZWQcMCE33WMa` handed off at 380k tokens). Build sessions: switches `session_01CtxXRGTqrS7tCXgFaNfw2J` (#23, top); incidents `session_01WENzUdPXvaK5xkdy2unUvu` (#19, fixing review findings, Sonnet); quote-redaction `session_013JDvtoKAXsUKX3tHsudwM2` (#17, NBSP fix in, awaiting review, top); 0.8 config `session_01BRzRb2vTpUcTLr8gLRnXcz` (Sonnet); 0.9b test timeouts `session_01NKCRQGK581AYjbjhh4hiEt` (#24, Haiku trial: judge it on review outcome before using Haiku more); 4.0b auth audit `session_01QpzxV9s4Wihw96LgQmmoBf` (top); 0.10 telemetry `session_016cJhsKgaKAhdbaffB5v8A5` (Sonnet). Done: cost-meter and audit-log (migrations applied), 0.9 transport (#20).
5. **On merge:** apply the migrations of #23 (two switches files), #17 and #19 (`docs/security.md` first; "Applying a merged migration" below). When switches merges, start round 2 (index.json): `product-catalogue` (Sonnet), `apify-gateway` (top; the live gateway folds in), `account` (Sonnet), `waitlist` (Sonnet). #23's body lists the switch-stub replacements for quote-redaction and cost-meter; make them backlog tasks.
6. **Build sessions skip reviews:** the reviewer posts from the same GitHub account, so a build session can sit "waiting on the reviewer" after a "Changes needed". When one idles, read `get_reviews` and send it the findings.
7. **Done 15:40 (coordinator 4):** the five drafts are integrated: 97 cards (`docs/design/modules/index.json`), backlog sections "Atomic module tasks" and "Draft integrations" with an ID map, 82 questions, legal rows 23 to 83, condensed docs under `docs/design/`; the catalogue page republish and the model tiers for the seven new modules follow. The original job: integrate the drafts not yet in the catalogue (`search-map-routes`, `listing-reuse`, `too-good-to-be-true`, `account-sharing`, the rest of `listing-location`) as module cards and backlog tasks, apply `catalogue-audit-changes.md` "Backlog changes", then republish the catalogue page (it predates `pricing-console`). This is the step that lets many more sessions run at once.
8. **Owner items open:** PostHog (EU) and Langfuse (EU) accounts and keys (`docs/design/analytics-growth.md` §7); the price-floor basis (`docs/questions.md`, default standalone). The owner said at 13:45 that he does not want to confirm things in other sessions and wants the coordinator to accept, confirm and go ahead; ask him only for accounts, secrets and payments.
9. **Spend:** coordinator 1 about $2,375 (large context); coordinator 3 $66. Keep contexts small.

**For the next coordinator.** The rest of this note is for you. Update it when you hand off in turn.

## Your role

You are the coordinator for Nabvy. You:

- keep `docs/progress.md`, `docs/backlog.md`, `docs/questions.md` and `docs/legal-review.md` current;
- apply every merged migration, module or gateway, soon after the merge (owner, 2026-09-24; the reviewer never touches Supabase), and check in the two-hour sweep that none is left unapplied;
- start and brief the build sessions, one session and one pull request per atomic module;
- turn designs into backlog tasks;
- record the owner's decisions in `docs/decisions.md`.

The reviewer session reviews, approves and merges every pull request, including yours. Work on your own branch and push in batches, about every 30 to 60 minutes (`CLAUDE.md`, "Working economy").

**Read first:**
- `CLAUDE.md`;
- this file;
- `docs/decisions.md`, above all "Precedence", "Atomic modules", "MVP scope and pipeline runtime" and "Every listing is reused";
- `docs/progress.md`;
- `docs/questions.md`.

Do not read the whole build pack. Read a file when a task needs it.

## Standing owner permissions and rules (2026-09-24)

**Permissions and approvals**
- **SQL.** Run any SQL on the live project without asking: "Execute SQL I allow you to execute everything. Do not ask me again".
- **Sessions.** Start sessions as you see fit, one per module, with tight briefs and the model the job needs (`CLAUDE.md`, "Working economy").
- **Merging.** The reviewer session merges everything for the production MVP. The owner has told the reviewer that decisions the coordinator records are the owner's.

**Scope and spend**
- **When Apify runs.** Nothing runs on Apify unless a user's hunt asks for it. The one exception is the team's own real "rtx3090" test hunt in Chichester, which is the end-to-end acceptance test.
- **Budget.** The Apify budget is $150 a month. The live gateway cap is still $5.50. Raising it is a migration through a reviewed pull request, planned as part of the spend-governor module.
- **Coverage.** National UK grid; Ireland is skipped.
- **Actor files.** Read only the actor files listed in `docs/fb-actor-sources.md`, and only lines 80 to 253 of `HANDOFF.md`. The rest of the actor repository is a separate project.
- **Facebook traffic.** Nabvy never deals with Facebook; its data is third-party data from Apify runs.
- **Actor calls.** Call only actor `YfdUav3sZ2BgEf8rh`, and only through the `apify-gateway` Edge Function. Never touch `JR2fdK8Nj6OLCwKkP` or the `marketplace_monitor` schema.

**Legal and policy**
- **Legal.** List points in `docs/legal-review.md`, one line each. Never run legal research, reviews or checks unless the owner asks.
- **Policies.** Every policy matches big tech practice, in Nabvy's own words.

**Conduct**
- **Secrets.** Never ask the owner to paste a secret in chat.
- **Product choices.** Ask when something is unclear; never assume a product choice.
- **Commits.** No model identifiers in commits or pull requests.

## Fleet at handoff (11:20 UTC, snapshot)

Check each row with `get_session` by ID and `list_triggers` before acting; sessions and blocks after this time are not listed. At each hand-off, fill in what each session is blocked on from a fresh `get_session` sweep. Since 15:15 the reviewer is `session_017YE3cbW8uLkFpu1gcByZyn` ("Nabvy PR reviewer (5)"); reviewers 1 to 4 (the last two `session_01N9Z7KMkngJHEJBjDEReGo3` and `session_01AxhGvp1bDTi7zahVzsJAii`) have handed off. The watchdog prompt names reviewer 4. Find a later reviewer with `get_session` on that ID, else `list_sessions` with `mine: true` and no `tags` filter (the filter errors inside a session), taking the newest non-archived row titled "Nabvy PR reviewer".

| Session | ID | Role and state | Its scheduled check-ins |
| --- | --- | --- | --- |
| Reviewer | `session_01BJMX3DUbvcfct6YS1HzneS` | Reviews, approves and merges. Told to review only new commits and to rely on CI for docs-only changes. Its context is about 680k tokens, so it has been told to hand off to a fresh reviewer session (look for the `nabvy-reviewer` tag with `list_sessions`) 11:31 (`trig_01Xnda3urx7DksX7gUec6bDV`). At that check-in it hands off and switches to events plus a 60-minute fallback |
| 4.1a web | `session_01WTj9DDh4ojbRPYGQvc8uaW` | PR #7, the design system and app shell. Its code fixes are done; it waits on the owner's decisions on on-screen wording 12:02 (lean: it waits on events and stops re-arming while it waits only on the owner) |
| 4.0 auth | `session_01CcwBErXfCaenzcEtRzHvvB` | PR #9, auth. The reviewer asked for changes: rate limits and a guard on the `better_auth` functions; it also conflicts with `main`. The session also opened PR #10, branded error pages stacked on #7. PR #10 is titled 4.1b, but 4.1b in the backlog is "User dashboard", so record it as 4.1c 11:46, covering both PRs (lean, as for 4.1a) |
| 1.1a actor scope | `session_011RWjM9pyFz1wrsBa58SGLN` | Actor scope clean-up and gateway input hardening. It was waiting for PR #4, which is now merged, so it opens its pull request next. Its own next check-in predates the lean rules, so send it them once with a one-shot trigger | 11:22 (fired) |
| Finished | 0.6 `session_01JNfP9yJf91DJBZK72Hnpbi`, 0.4 `session_01SnM17CVEmK2WtWkpbH2CfZ`, foundation `session_014ie5uCxNhB9DRmZRmUQymC` | Their pull requests are merged. Their last check-ins will find that and stop. Archive them only if the owner agrees | none needed |

**Pull requests.** Merged: #1, #2, #3, #4 (`f987bec`, 11:10 UTC), #5, #6, #8. Open: #7, #9, #10.

## Live systems

**Database.** Supabase project `fbapfy` (ref `rlgufxmsrkhyeiabdeic`).
- **Module migrations.** The ledger `nabvy_core.schema_migrations` holds all four module migrations on `main`, so nothing is pending:
  - `core/20260924090000_core_foundation.sql`;
  - `better-auth/20260924093928_better_auth_tables.sql`;
  - `better-auth/20260924093930_better_auth_access.sql`;
  - `core/20260924110000_core_hardening.sql`.
- **Gateway migrations.** The six `supabase/migrations` files for the gateway are applied under different live version numbers. `supabase/README.md` records that drift.

**Applying a merged migration.**
1. Run `node packages/db/scripts/migrate.mjs plan`.
2. Run `node packages/db/scripts/migrate.mjs emit <module>/<file>`.
3. Apply the emitted SQL with the Supabase MCP `apply_migration`.
4. Check the ledger row and checksum.

Before applying any migration, read `docs/security.md` (CLAUDE.md requires it for every migration).

**Apify gateway.** The Edge Function `apify-gateway` is at version 9, matching `main`. Paid use so far is one run, job 6: run `VkryjpwS6U2GBDh3k`, 20 listings, $0.0177. Job 15 was a free re-collect of the same data.

## Design drafts

The predecessor's design workflows write raw drafts. As each finishes, it is committed to branch `claude/hopeful-wright-r5ygps` under `docs/design/drafts/`, and the predecessor sends you a message naming the file. When that happens, run `git fetch origin claude/hopeful-wright-r5ygps` and merge that branch into yours.

| Draft | Subject | State at handoff |
| --- | --- | --- |
| `modules.md` | The atomic module catalogue (about 320 KB; 89 modules, 15 build rounds, final audited version) | Landed |
| `catalogue-audit-changes.md` | The final audit's change log. It has three points to take to the owner: five dependencies made soft so the rtx3090 test does not wait for billing or photos; three placeholder modules; task-ID clashes with the account-sharing and listing-reuse drafts | Landed |
| `copy-advert.md` | The copy-advert spam module | Landed |
| `actor-integration.md` | How Nabvy uses the actor: planning, scheduling, spend, ingest | Landed |
| `account-sharing.md` | Account-integrity: sharing protection, bans, ban evasion | Landed |
| `listing-location.md` | Where an item really is: the location field, "collection from X", autofill mistakes | Landed |
| `search-map-routes.md` | eBay-style filters, the map with approximate markers, distance with "worth the trip" hints, pickup route planner | Landed |
| `too-good-to-be-true.md` | Marking scam-like listings from listing signals plus one-tap user reports | Landed |
| `listing-reuse.md` | Reusing listings other than the one searched for (by-catch): shared pool, price learning, cross-hunt matching, gems, similar picks | Landed |

Treat the drafts as design notes, not decisions. A product choice in them goes to the owner or to `docs/questions.md`; a legal point goes to `docs/legal-review.md`, one line each.

## Coordinator 2 progress (11:40 UTC)

- Coordinator 2 is `session_01XSTcLZmm35nVGEa6LhMoUj`. Its sweep is a `send_later` one-shot (first `trig_01CwBXXkRWpiedQRwLUWehdB`, 12:30 UTC), re-armed two hours ahead at each sweep.
- Step 1 done. 1.1a has opened PR #11 (CI green) and was sent the lean rules (`trig_01C6kjk9gD4WMtKcxvDap5YU`).
- Step 2 done: cards in `docs/design/modules/` (re-run `node scripts/split-module-cards.mjs` when the draft changes), catalogue page https://claude.ai/artifact/TYppyezuT2g3Nmv2CGSxbD. It proposes starting each module when its hard dependencies are merged, rounds 0 to 2 first, so the earlier wave-1 list below moves to rounds 3 to 16. Model tiers are set in the page (top model for 40 modules: pipeline core, security, money; Sonnet for the rest).
- Step 5: PR #10 recorded as 4.1c, PR #11 as 1.1a in `docs/progress.md`.

## Wave 1 (12:45 UTC)

The owner said "launch wave 1 now". Round 0 is running, one session each, briefs from the template in this session (card + `_rules.md` + `docs/session-conventions.md` via `git show origin/claude/coordinator-2:` until PR #12 merges): see the table in `docs/progress.md`. Start each later module when its hard dependencies are merged (round order in `docs/design/modules/index.json`), with the model tier from the catalogue page.

## Spend

Updated only at batched pushes, from the sweep's `get_session` calls; `cost_usd` is cumulative per session.

| Date | Fleet total | Largest |
| --- | --- | --- |
| 2026-09-24 11:40 UTC | about $885 | coordinator 1 $579, reviewer 1 $206, 1.1a $40, 4.1a $21, 0.4 $16, 4.0 $11, 0.6 $7 |

## Lean-workflow review (12:20 UTC)

An adversarial review of the lean rules (five lenses, two skeptics per finding) found 28 gaps, none refuted. The safe fixes are in this note, `docs/session-conventions.md`, `supabase/README.md` and backlog 0.7. The rest waits on the owner (`docs/questions.md`, "lean working"). Owner answers (12:30): the coordinator applies migrations; the SQL allow-rule stays fleet-wide; an hourly Sonnet watchdog replaces the reviewer's fallback; the next coordinator runs on the top model at effort high with ultracode off (the owner sets effort and flags; `create_session` cannot). Ultracode off does not limit parallel work: the coordinator still starts many build sessions at once with `create_session`; ultracode only governs in-session workflow fan-out, which stays available when a task calls for it. Done at 12:35: the four merged migrations are applied (three better-auth, one gateway); the watchdog is Routine `trig_011fjd2grZBEWR3FqfDzTWJR` (fresh session each hour at :34, Sonnet; it wakes the reviewer by ID for a PR head unreviewed over an hour, and the coordinator if no sweep is armed). The reviewer drops its own fallback once a watchdog run is confirmed. Do not move cadences to under an hour, message idle sessions to adopt conventions, or hand off a session only to change its model: each costs more than it saves.

## Next steps, in order

0. **Pull request subscriptions** are per session and do not carry over. Subscribe with `subscribe_pr_activity` to your own pull requests only. Build sessions and the reviewer subscribe to theirs, so you do not need events from #7, #9 or #10.
1. **Set one scheduled sweep, every two hours from about 12:30 UTC,** with `send_later`. This replaces the old hourly fleet check and the separate actor-documents check. Each sweep does the following:
   - **Re-arm first.** Before any other call, re-arm the next sweep two hours ahead, so a sweep that fails part-way still leaves one armed. Record its trigger ID in this note.
   - **Fleet.** Call `get_session` by ID for each session in the fleet table. In the message to the owner, name any session that is blocked or has `needs_action` set (session ID and what it waits on), and any idle session over 300k used tokens; do not wake them. Keep each session's `cost_usd` and `used_tokens` for **Spend** below, written at the next batched push only.
   - **Pull requests.** List them with the `fields` filter and a small `perPage`. For each merge, update `docs/progress.md` and check its migrations are applied: module migrations in the `nabvy_core.schema_migrations` ledger, gateway files in `supabase/migrations` against `list_migrations` (read only; live versions differ, see `supabase/README.md`). Name any merged migration still unapplied in the message to the owner.
   - **Reviewer.** If a pull request has sat unreviewed for over an hour, wake the reviewer (by session ID, never by tag) with a one-shot trigger.
   - **Stale check-ins.** `list_triggers` with `enabled: true`. Delete a one-shot check-in only when every pull request its prompt names is merged or closed.
   - **Actor documents.** Attach `sebtimize/fb-scrap-engine` with `add_repo` (read access), fetch it and check:
     - whether `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` now exist;
     - whether any file on the owner's list changed since `d7be0a4` (checked 12:40 UTC: `d7be0a4` made legal review optional and added "keep the UK GDPR basics: a privacy notice and deletion and objection requests"; the two guides still do not exist). Use the GitHub API, not a clone, so the actor repository's own `CLAUDE.md` never loads. The T2 results should land in `EVIDENCE_LEDGER.md` after about 21:00 UTC.

     Read only the listed files, and tell the owner only when something changed.

   If nothing changed, end without comment; the sweep is already re-armed.
2. **Publish a condensed module catalogue for the owner's approval,** as one page (an Artifact). For each module, show its job, its wave, its dependencies and the model tier the job needs. First split `docs/design/drafts/modules.md` into one card per module under `docs/design/modules/`, with a script rather than an agent, so a build session reads only its own card. Build the page from the cards. Wave 1 does not start until the owner approves.
3. **Integrate each draft as it lands.** Condense it into `docs/design/<name>.md`. Add backlog tasks, using letter suffixes, and rows in `docs/progress.md`. Put the owner questions in `docs/questions.md`. Open one batched pull request.
4. **Launch wave 1** after approval, one session per module. Each session gets a brief naming its card and the few files it needs, and the model its job needs: the top model for the pipeline core, security and money; Sonnet for web wiring, UI and CRUD-shaped work. Tell each session to wake the reviewer with a one-shot trigger when it opens its pull request. Every `create_session` passes `model` from the card's tier (never inherit the caller's) and the caller checks `configured_model` in the response. Each brief gives the reviewer's session ID and points to `docs/session-conventions.md`; do not restate the rules. The modules:
   - region planning;
   - demand-driven scheduling;
   - spend governor, with the $150-a-month cap migration;
   - ingest and details;
   - copy-advert;
   - parts;
   - noise;
   - web wiring;
   - scan (vision AI per scan, capped per user);
   - account-integrity;
   - billing, once Stripe is set up.
5. **Keep records current.** Add a 4.1c task to `docs/backlog.md` for PR #10's scope: branded error pages and the restricted-account notice, stacked on PR #7. Then record PR #10 against it in `docs/progress.md`. Keep `docs/progress.md` current after every merge.

## Waiting on the owner

- **Auth database login.** Enable login for `nabvy_auth` and set its password yourself in the Supabase SQL editor, then add the connection string as the environment secret `DATABASE_URL_AUTH` (`docs/secrets.md`). Agents never generate or see this password.

- **Stripe test mode.**
  - Add a test secret key as an environment secret.
  - Allow Stripe in the environment's network policy: `*.stripe.com` and `*.stripe.network`. If wildcards are not accepted, add `api.stripe.com`, `checkout.stripe.com`, `js.stripe.com` and `m.stripe.network`.
  - Enable Stripe Tax.

  Until then 4.3 is blocked. When explaining how, use `read_documentation` with the `environment.secrets` and `environment.network` topics.
- **Accounts.** Trigger.dev, the Anthropic API, a Telegram bot, Vercel and Resend, plus Cloudflare DNS for 0.5a.
- **PR #7.** Decisions on its on-screen wording.
- **Module catalogue.** Approval, once you publish it.
