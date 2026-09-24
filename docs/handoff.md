# Coordinator handoff

**For the owner.** The first coordinator session, `session_012J8dDJ1GUtySk77vK6SNjM`, handed off to a fresh one at about 11:20 UTC on 2026-09-24 because its context had grown large. It did this under your rule in `CLAUDE.md`, "Short sessions: hand off on your own". The old session now only commits the design drafts still being written as each one finishes. Follow the new coordinator from here.

**For the next coordinator.** The rest of this note is for you. Update it when you hand off in turn.

## Your role

You are the coordinator for Nabvy. You:

- keep `docs/progress.md`, `docs/backlog.md`, `docs/questions.md` and `docs/legal-review.md` current;
- check in a two-hour sweep that the reviewer has applied each merged migration; since the owner's lean request of 11:20, the reviewer applies them straight after merging;
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

## Fleet at handoff (11:20 UTC)

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

Before a migration that touches auth or roles, read `docs/security.md`.

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
| `too-good-to-be-true.md` | Marking scam-like listings from listing signals plus one-tap user reports | Being designed |
| `listing-reuse.md` | Reusing listings other than the one searched for (by-catch): shared pool, price learning, cross-hunt matching, gems, similar picks | Landed |

Treat the drafts as design notes, not decisions. A product choice in them goes to the owner or to `docs/questions.md`; a legal point goes to `docs/legal-review.md`, one line each.

## Next steps, in order

0. **Pull request subscriptions** are per session and do not carry over. Subscribe with `subscribe_pr_activity` to your own pull requests only. Build sessions and the reviewer subscribe to theirs, so you do not need events from #7, #9 or #10.
1. **Set one scheduled sweep, every two hours from about 12:30 UTC,** with `send_later`. This replaces the old hourly fleet check and the separate actor-documents check. Each sweep does the following:
   - **Fleet.** Call `get_session` by ID for each session in the fleet table.
   - **Pull requests.** List them using the `fields` filter. For each merge, update `docs/progress.md` and check the migration ledger.
   - **Reviewer.** If a pull request has sat unreviewed for over an hour, wake the reviewer with a one-shot trigger.
   - **Actor documents.** Attach `sebtimize/fb-scrap-engine` with `add_repo` (read access), fetch it and check:
     - whether `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` now exist;
     - whether any file on the owner's list changed since `f177a44`. The T2 results should land in `EVIDENCE_LEDGER.md` after about 21:00 UTC.

     Read only the listed files, and tell the owner only when something changed.

   If nothing changed, re-arm without comment.
2. **Publish a condensed module catalogue for the owner's approval,** as one page (an Artifact). For each module, show its job, its wave, its dependencies and the model tier the job needs. First split `docs/design/drafts/modules.md` into one card per module under `docs/design/modules/`, with a script rather than an agent, so a build session reads only its own card. Build the page from the cards. Wave 1 does not start until the owner approves.
3. **Integrate each draft as it lands.** Condense it into `docs/design/<name>.md`. Add backlog tasks, using letter suffixes, and rows in `docs/progress.md`. Put the owner questions in `docs/questions.md`. Open one batched pull request.
4. **Launch wave 1** after approval, one session per module. Each session gets a brief naming its card and the few files it needs, and the model its job needs: the top model for the pipeline core, security and money; Sonnet for web wiring, UI and CRUD-shaped work. Tell each session to wake the reviewer with a one-shot trigger when it opens its pull request. The modules:
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

- **Stripe test mode.**
  - Add a test secret key as an environment secret.
  - Allow Stripe in the environment's network policy: `*.stripe.com` and `*.stripe.network`. If wildcards are not accepted, add `api.stripe.com`, `checkout.stripe.com`, `js.stripe.com` and `m.stripe.network`.
  - Enable Stripe Tax.

  Until then 4.3 is blocked. When explaining how, use `read_documentation` with the `environment.secrets` and `environment.network` topics.
- **Accounts.** Trigger.dev, the Anthropic API, a Telegram bot, Vercel and Resend, plus Cloudflare DNS for 0.5a.
- **PR #7.** Decisions on its on-screen wording.
- **Module catalogue.** Approval, once you publish it.
