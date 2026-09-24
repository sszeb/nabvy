# Account sharing: the account-integrity module

**Status:** design proposal for the owner, 2026-09-24. Nothing in `/home/user/nabvy` has been changed.
**Module:** `account-integrity` (`services/account-integrity/`, Postgres schema `account_integrity`), built as an atomic module under `docs/decisions.md`, "Atomic modules".
**Based on:** `docs/decisions.md` (above all "Fair use, suspension and bans" and "Automatic, autonomous and internal"), `docs/security.md`, `docs/web-app.md`, `docs/modules.md`, `docs/contracts.md`, `docs/engineering.md`, and five research briefs run on 2026-09-24 (streaming services, SaaS and AI products, security UX, paid alert products, open-source stack).
**Law:** as the owner instructed, no UK law has been researched, analysed or applied. Points that may need a lawyer are listed in section 6 as one-line items, with no analysis.
**Revised:** 2026-09-24, after two critiques: one on friction for honest users, one on evasion. Where they pulled in opposite directions, this version takes the balance the owner asked for ("strong but not cumbersome"). An automatic sign-out, limit or ban should not rest on evidence an honest user can produce, so there the less cumbersome option wins. Where the cost to an honest user is one approval tap with a way round it, the stronger option wins. Either way the losing option is kept as an owner decision (D23 to D25 in section 9), and each place says why.

---

## Summary for the owner

The owner asked: *"Like only available on one device and auto log off from other devices?"*

- **Yes to "one device at a time". No to "sign out the others every time".** Nabvy should work on **one live screen at a time**, with a one-tap **"Use here"** that *pauses* the other screen rather than signing it out. Spotify and YouTube Premium individual plans work this way [S1][S3], and WhatsApp Web reportedly does too [S50]. Forced sign-out costs Nabvy more than most apps, for two reasons. Sign-in is by magic link, so every sign-out means a trip to the inbox. And web push stops on a phone that has been signed out, so the user's alerts would stop too.
- **A small cap on signed-in devices:** 2 on Free and Standard, 3 on Pro, with an installed app and its browser on the same phone counted as one. When a new device goes over the cap, a picker asks which device to sign out, as Adobe does [S30]. Microsoft signs out the oldest automatically [S27].
- **The biggest leak is alerts forwarded to groups, not shared logins. Nabvy can make it slower, smaller and riskier, but cannot prevent it.** Whatever a payer can read, they can retype, screenshot or relay with a script. Delivery controls stop the easy routes:
  - Telegram alerts go only to one private chat and are sent protected against forwarding [S53];
  - an alert link opens for the recipient and at most three other people, and every open is logged (3c).

  The rest is bounded by what one subscription covers (its areas, its hunts and 20 alerts an hour). It is caught by the relay signals in 3d, which move the account to limits and then suspension. Section 3g lists what the design does not stop.
- **Honest users always have a way back in.** Every sign-in email carries a code as well as a link, so the installed iPhone app can sign in. A device the account already knows never needs approval after an enforcement sign-out. An approval screen always offers "I can't get to my other device". The inbox can sign out every device, including a stolen phone (3a, 3b).
- **Detection is silent, and enforcement is automatic and stepped:** re-verify, then limit, then suspend, then ban. Users see only a short, vague notice. Every reason, rule, signal and score stays internal, and admins see everything, as the owner decided.
- **Nothing new to buy.** The design uses Better Auth's hooks and plugins, Vercel's geolocation headers and grammY, plus rules built in-house. Version 1 needs no fingerprinting library.

---

## Owner rules this design follows

| Rule (source) | How the design meets it |
| --- | --- |
| Enforcement is automatic and autonomous (`docs/decisions.md`, "Automatic, autonomous and internal") | Every step in the ladder (3e) is applied by the module's own rules and needs no human. Admins can review, override and lift, and each of those actions is audited |
| Reasons, rules, evidence, signals and scores are never shown to any user, in any channel | Notices come from a fixed list of four texts (3e). Anything shown to users is typed as a separate output schema that has no reason fields, and a CI test fails if a reason, rule ID, signal or score reaches user-facing output (section 7). The Better Auth ban message is fixed and never carries `banReason` [B6] |
| Account status is checked on every signed-in request and by every job | `v_account_status` is read by the oRPC middleware and by every job that acts for a user (section 5) |
| No personal data beyond need (`CLAUDE.md`) | Networks are stored as keyed hashes of an IP prefix. Locations are stored at town level and rounded to about 11 km. No GPS is used, and scan mode's location is never reused (3d) |
| Atomic modules: one job, its own tables, views and events, can be switched off (`docs/decisions.md`) | Section 5. `ACCOUNT_INTEGRITY_MODE=off` makes every hook and check return "allow"; any status already set keeps working through the view, and timed statuses still expire |
| Batches, idempotent handlers, thin events, stamped hops (`CLAUDE.md`) | Scoring runs as Trigger.dev batch tasks over arrays of users. Signals and actions carry idempotency keys. Events carry IDs only. Each action records when it was observed, detected, scored, applied and notified (section 5) |
| Speed is a property of the cell, never an artificial delay (`docs/decisions.md`, Pricing and cadence) | No enforcement step delays alerts. Throttles limit counts and channels, not speed. Whether to allow a digest fallback is an owner decision (section 9, D11) |
| No database access from the browser; no business logic in procedures | The devices page, the lease and approvals are oRPC procedures that call module functions inside `withUser` |

---

## 1. What big tech does, and what works

**How to read the evidence.** Tags such as [S12] point to the source list at the end. Each entry there gives the URL and the date the page shows, or "undated" with the date it was seen (2026-09-24). An egress proxy blocked direct fetches of most vendor help centres, so the researchers read those pages through search-engine extracts. The Better Auth, Microsoft Entra, OWASP, grammY, W3C and library licence files were read first-hand from GitHub or npm. "Reported" means a practice described by users or the press, not documented by the company.

### 1.1 Practices worth copying

| Practice | Who does it (evidence) | What happened | Lesson for Nabvy |
| --- | --- | --- | --- |
| **Limit use at the same moment, not logins.** The last device to start playing takes over | Spotify: any number of signed-in devices, playback on one at a time [S1][S2]. YouTube Premium individual: one device, "Playback paused because your account is being used in another location" [S3]. WhatsApp Web "Use here" (reported) [S50] | Widely accepted and simple to understand [S1] | **One live screen per account, with "Use here"** (3a) |
| **Small cap on signed-in devices** | Microsoft 365: 5 devices signed in at once; a sixth sign-in signs out the oldest automatically [S27]. Adobe: signed in on 2, apps in use on 1; the third sign-in shows a picker with "Sign out" on each device [S29][S30]. Monzo: one Android and one iOS device [S59] | Nothing to notice below the cap | **A cap of 2–3 devices with a picker** (3a) |
| **A device and session list with remote sign-out** | Netflix "Manage access and devices", 15 Nov 2022 [S8]; Google [S43]; ChatGPT, up to 30 minutes to take effect [S33]; OWASP recommends it [S62] | Netflix called it "much-requested" [S8] | **Devices page** under `/app/account` (3a) |
| **Alert on a new sign-in, with a one-tap "not me"** | Google [S44]; Meta alerts only for unrecognised devices and browsers [S46] | Honest users can ignore it. Credentials passed around become visible to the payer | **New-device email and Telegram alert** (3b) |
| **Approve a new device from one the user already holds** | Apple sends a code to trusted devices, with an approximate map [S47]; WhatsApp links a device by QR code from the primary phone [S49] | A password or code posted to a group is useless without the owner acting at that moment | **Approval step, only when risk is raised** (3b) |
| **A verification link to the owner, with a short expiry** | Netflix household update: "Yes, This Was Me", link expires in 15 minutes [S7] | The borrower needs the payer every time | Magic link, which expires after 5 minutes by default [B7] |
| **New sessions cannot take over at once** | Telegram: a new session cannot end older sessions for up to 24 hours [S51][S52] | Stops someone with a login code from locking out the owner | **24-hour new-session lock** (3b) |
| **Step up only on risk or for sensitive actions** | Google asks for extra checks only on unusual sign-ins, and needs a device registered for 7 days for sensitive changes [S45]. NCSC advises against a second factor every time [S61] | Invisible most of the time | Checks on risk and on sensitive actions only (3b) |
| **Offline scoring of impossible travel, with a learning period** | Microsoft Defender says impossible travel indicates "a different user is using the same credentials". Entra learns for 14 days or 10 sign-ins and ignores VPNs [S56][S57] | Detections need a learning period, and several are calculated offline [S56] | **Nightly batch signals with tolerances** (3d) |
| **Degrade the service before any ban** | ChatGPT limited Plus users to a smaller model until they secured the account (reported) [S34]. YouTube pauses benefits after 14 days' notice (reported) [S5]. Spotify moves the Family member, not the payer, to Free [S20] | The fix itself removes the borrowers | **Re-verify and limit before suspension** (3e) |
| **A graduated ladder: warning, then temporary, then permanent** | GitHub Copilot emails (reported) [S40][S41]; LinkedIn Recruiter documents notification, then suspension, then permanent restriction [S37] | Clear escalation | **Four-step ladder** (3e) |
| **Tie delivery to one messaging identity, and make re-binding cost something** | Telegram `protect_content` (Bot API 5.6, 30 Dec 2021) [S53]; per-member invite links (InviteMember) [S74]; Kodai's 3-month unbind cool-down [S72]; LaunchPass unlinks the old Discord account on change [S73] | Stops the one-tap forward, which is the commonest leak | **One private Telegram chat, protected alerts, limited re-links** (3c) |
| **Links unique to each subscriber, with a reset** | Stratechery's per-subscriber feeds, "Feed Reset" [S75]; Mailchimp unique URLs survive forwarding [S76] | A feed polled by a group stands out, and a reset cuts it off | **Signed alert links and key rotation** (3c) |
| **Identify and count, not only prevent** | CME data licences: simultaneous access "must be prevented, or ... reported and charged" [S81] | Nabvy has no such mandate, so counting is enough | Signals first, enforcement on outliers (3d) |
| **Soft first, aimed at the heaviest sharers** | HBO Max: a "gentler, cancelable" message to the highest tier of usage first, firmer later [S18] | A staged rollout | **Shadow, then soft, then hard** (section 8) |
| **A paid way out for sharers** | Netflix Extra Member, UK £5.99 with ads or £6.99 without from 3 Sep 2026 [S9]; Disney+ £4.99 in the UK at launch [S17]; LinkedIn Premium Duo [S38]; Netflix Profile Transfer [S10] | See 1.3 | **An optional extra seat** (3f) |
| **Make the account worth protecting** | Amazon makes two adults agree to share payment methods before they share Prime [S24]; Apple shows sign-in codes on the owner's own devices [S25]; Microsoft keeps Copilot AI credits for the owner only [S28] | Sharing costs the payer something | Sensitive actions need extra checks, and the inbox is the credential (3b) |

### 1.2 What caused backlash, and what to avoid

| Approach | Who and what happened (evidence) | What Nabvy does instead |
| --- | --- | --- |
| **Hidden caps** | Disney+ says only that "there may be a limit" on "away from home" [S15]. The cap is reported as 4 a year, with paying users locked out [S16] | Publish plan limits (device count, one live screen, one Telegram chat) and show the user where they stand on the devices page. Detection rules stay internal (section 9, D3) |
| **Long lockouts that are not explained** | Spotify's 12-month ban on joining another Family plan [S20]; Keepa blocks of hundreds of hours (reported) [S71]; Unusual Whales auto-locks for up to 24 hours [S70] | Short early steps that clear themselves (re-verify, then 7-day limits). Longer steps only after repeats. The owner's vague-notice rule is kept, so early steps must be fixable by the user without an explanation |
| **Flagging ordinary use of two devices** | Adobe community threads (mid-2024 onwards) describe paying single users with a desktop and a laptop flagged as "sharing" [S31]. NYT readers call its new-device passcode emails "extremely aggressive" [S26] | Never act on "two devices" alone. A verified device is remembered, and step-up happens only on risk (3b) |
| **Tight limits on device swaps** | YouTube downloads: 4 swaps a year [S4]; Prime Video India: 5 devices, 2 of them TVs, 2 swaps in 30 days, with complaints (reported) [S22][S23] | A generous new-device allowance. Going over it triggers approval, not a block (3b) |
| **GPS or precise location** | Spotify ended its Family GPS test after complaints in 2018 [S21]. Netflix and Disney+ say they do not use GPS [S6][S15] | IP-level town only. Scan mode's location permission and hunt postcodes are never used (3d) |
| **Household or home-network rules** | Netflix anchors on the TV and home Wi-Fi [S6]. The model assumes a fixed home, which does not fit mobile users | No household concept. Resellers hunt on mobile data |
| **Forced periodic re-authentication** | FCA PS21/19: respondents said 20–40% of customers were lost at the 90-day re-authentication point [S60]. Microsoft warns about "MFA fatigue" [S58] | Keep the 30-day sessions. Revocation happens when an event calls for it (3a) |
| **Identity or selfie checks** | LinkedIn asks restricted accounts for government ID through Persona [S39]; banks ask for selfies on new devices (Monzo reports) [S59] | Not used |
| **Passkeys as an anti-sharing control** | Apple lets users share passwords and passkeys with groups [S66] | Passkeys optional later, for convenience only |
| **Links that sign people in** | Reported: a forwarded Substack email signed the recipient into the forwarder's account [S77] | Alert links identify the recipient but never authenticate (3c) |
| **Fabricated "canary" content** | Canary traps are reported (Tesla, Genius) [S78] | Never, under "No invented numbers" (`CLAUDE.md`). Only an optional harmless variation in layout (3c) |

### 1.3 What enforcement achieved

- **Netflix, after the rollout on 23 May 2023:**
  - US sign-ups had their four highest days on record, averaging 73,000 a day, up 102% (Antenna, a panel estimate) [S11];
  - Netflix said "the cancel reaction continues to be low" [S12];
  - Kantar estimates Netflix Spain lost over 1 million users in Q1 2023 [S13];
  - in 2022 Netflix dropped its "add a home" fee in Latin America after protests [S14].
- **The pattern that worked commercially** put almost no friction on genuine users. It fell only on the device that looked like a borrower, and offered a cheap legitimate route at each step [S11][S12].
- **None of the consumer subscriptions studied** makes an individual plan work on one signed-in device with automatic sign-out elsewhere. Banks (Monzo [S59]) and professional terminals (Bloomberg locks the desktop when the user signs in on mobile [S69]) do, and their users accept the friction for regulatory or employer reasons.

---

## 2. Threats specific to Nabvy, ranked by revenue impact

Nabvy sells **speed and exclusivity**. A leak costs the subscriptions the recipients would otherwise buy. It also makes the product worse for every paying user in the same area, because they are racing the leak group for the same listings. Group sizes and revenue figures below are illustrative ceilings, not measurements or forecasts; the revenue figure uses the published prices (Standard £9, Pro £29, `docs/decisions.md`).

| Rank | Threat | Why it ranks here | How it usually looks | Main controls |
| --- | --- | --- | --- | --- |
| 1 | **Alerts forwarded to a group** (Telegram group, Discord, WhatsApp) | There is no limit on fan-out. One Pro account feeding a 50-person group replaces up to 49 Standard plans, a ceiling of about £441 a month, but only for members inside its three areas. Members elsewhere need extra areas (£4 each, `docs/billing.md`), and the account stays capped at 20 alerts an hour (`docs/modules.md`). It is the cheapest leak (one tap) and hurts exclusivity for everyone in the area. Leak groups for paid signals advertise "no delay" (reported) [S80] | The payer forwards each Telegram alert, relays it with a userbot, or pastes email alerts into a chat | Protected Telegram alerts, private chats only, signed links, fan-out signal, link rotation (3c, 3d); plan scope and the relay signals (3d); not preventable at delivery (3g) |
| 2 | **Resold accounts** ("Nabvy Pro access £5 a month" in reseller communities) | Commercial and repeated, with many buyers per account (illustrative: 5–50). It usually combines threats 1, 3 and 5 | A shared inbox or a relay of magic links, many devices across many towns, lease ping-pong, alert relays | Device cap, approval on risk, device churn and concurrency signals, fast path to a ban (3a, 3b, 3d, 3e) |
| 3 | **A shared login used by several people** | Likely the most common case, but the groups are small (illustrative: 2–4 people), so each loses 1–3 plans | Friends or family share the magic-link inbox or the Google account | One live screen, device cap, new-device alerts to the payer (3a, 3b) |
| 4 | **Bot or automated use** | Scripts poll the feed or API and repost it, which is what makes threats 1 and 2 scale. They also add cost and can be used to fake the "too good to be true" reports that other users see | Requests at a steady pace with no idle gaps, headless user agents, API keys used from many networks | Rate limits already set in `docs/engineering.md`, Better Auth rate limits on database storage [B9], an automation track in scoring (3d) |
| 5 | **Push or Telegram linked to someone else's device** | Limited by the caps to 1–3 extra people, but it is quiet and gets round the session rules | The Telegram link opened on a friend's phone; push turned on for a friend's browser | Push only on signed-in devices within the cap; the Telegram link created only from an established device; opens from devices not on the account (3c, 3d) |

---

## 3. The recommended design

It is built in layers. Each layer is cheap for an honest user and gets more expensive as sharing grows. Layers a to c are ordinary **product behaviour**, the same for everyone and on from launch. Layers d and e are **enforcement**: automatic and internal, and switched on in stages (section 8). Layer g lists what no layer stops.

### 3a. The session and device model

**The options compared.**

| Option | How it works | What it stops | Cost to an honest user | Verdict |
| --- | --- | --- | --- | --- |
| **A. The owner's suggestion:** one signed-in device, with automatic sign-out elsewhere | Each new sign-in revokes every other session (Better Auth `revokeOtherSessions` [B2] called from the session-create hook [B3]) | Use at the same moment; casual sharing | High. Every switch between phone and laptop needs a new magic link from the inbox. Push alerts on the phone stop whenever the laptop signs in, because push is tied to a signed-in device (3c). Among the services studied, only a bank and a professional terminal work this way [S59][S69] | Kept as a switch: it is used, in targeted form, as an enforcement step (L1 signs out only the devices in the evidence; L2 applies strict mode; 3e) and can be turned on per plan ("strict mode"), but it is **not the default** |
| **B. TradingView-style connection count** | N open connections. When the limit is reached, the oldest is closed and a "Connect" button takes it back [S67][S68] | Heavy use at the same time | Low | Tabs are the wrong unit to count, and users script round the pop-up (reported) [S68] |
| **C. WhatsApp Web or Spotify style (recommended):** several signed-in devices, one live screen, "Use here" | Signed-in devices are capped. Only one device holds the **live lease** at a time. Taking it pauses the other device and never signs it out [S1][S3][S50] | Two people using the account at the same moment | One tap, and only when two screens are live together | **Recommended** |

**Recommended defaults** (owner decision D1; the numbers per plan are in 3f):
- **Signed-in devices:** 2 on Free and Standard, 3 on Pro, 3 per seat on Business.
- **Live screens at once:** 1 per account (1 per seat on Business).
- **Why:**
  - One live screen stops simultaneous use by two people, which is what the owner asked for. It costs a single user one tap, and only in the rare case that both screens are in active use at once.
  - A cap of 2 or 3 fits the normal phone-plus-laptop pattern that even Adobe allows [S29]. It also bounds push fan-out, because push exists only on signed-in devices.
  - Revocation stays **triggered by events**, not by time. Nabvy keeps its 30-day sessions (`docs/security.md`) and does not force periodic sign-ins [S58][S60].

**What counts as a live screen.** The deal feed, the map and search, which are the surfaces whose value is speed. Not live: a single deal card opened from an alert, hunts, the account pages, billing, and all alert delivery (Telegram, push, email). An alert opened on the phone therefore never interrupts the laptop.

**How the lease works:**
- The device holding the lease sends a heartbeat every 30 seconds while a live surface is visible. Each heartbeat carries the time of the last pointer, key, touch or scroll event. Hidden tabs send nothing.
- **Visibly live** means the live surface is visible and has had a pointer, key, touch or scroll event in the last 2 minutes. A visible but idle screen counts as hidden, and another device takes the lease silently. The browser reports a tab as visible whenever it is the front tab of a window that is not minimised [R10], so visibility alone would keep a feed left open on a desk monitor "live" all day.
- When a live surface is hidden, the client sends a release (`navigator.sendBeacon`), so the next device can take over silently. A missed release is covered by the lease lapsing 90 seconds after the last heartbeat.
- A device opening a live surface takes the lease **silently** if the holder is hidden, idle or lapsed. It shows **"Use here"** only when the other device is visibly live.
- A device that lost the lease takes it back silently on its next pointer, key, touch or scroll event if the holder is hidden, idle or lapsed. So a laptop closed before its release reached the server never makes the phone wait or ask.
- Tabs on the same browser share one device ID, so they share the lease (unlike TradingView, which counts tabs [S67]).
- Every takeover is written to `lease_events` as `silent` or `use_here`. Only contested "Use here" takeovers can become a signal (3d); silent ones are one person moving between devices.

**What the user sees.**
1. Sam has the feed open on his laptop, then puts it aside and opens Nabvy on his phone. The laptop tab is hidden, so the phone becomes live silently. Nothing is shown.
2. If the laptop feed is still visibly live, the phone shows: **"Nabvy is open on another device."** with a **[Use here]** button. One tap and the phone is live. The laptop's feed stops updating under: **"Nabvy is open on your other device."** with **[Use here]**. Nobody is signed out and no email is sent.
3. Telegram and push alerts keep arriving on both devices throughout.

**The signed-in cap.** When a sign-in would go over the cap, the new device shows:

> **You're signed in on 2 devices, the most your plan allows. Choose one to sign out.**
> ○ iPhone (app and browser) · approx. Chichester · active now
> ● Windows · Chrome · location unknown · 3 days ago (selected)
> [Sign out and continue]

- The least recently active device is selected by default, except a device that holds the account's only push subscription.
- The picker and the Devices page show "approx. <town>" only for a settled network (3d), and "location unknown" otherwise. The headers Nabvy reads carry no network type [V1], so the design cannot reliably say "mobile network".
- The signed-out device's next visit shows "You were signed out on this device because you signed in on another one."
- When the new device is also unrecognised, one message covers both events, by email and Telegram if linked: **"New sign-in to Nabvy: iPhone · Safari. Approximate area: Chichester (worked out from the network). To make room, Windows · Chrome was signed out. Not you? [Secure my account]"**. When the new device is already recognised, only the signed-out device's next visit shows a notice, and no email is sent. The user chose the sign-out themselves, and a second message about it reads like an intrusion alert; NYT readers called that kind of email "extremely aggressive" [S26].
- **The older device wins disputes.** Pressing "Not you?" on it signs the new device out, rotates alert links and asks for a fresh magic link or code. A new device can therefore take a slot at the cap, but it cannot hold the account against the payer.
- **Sign out everywhere from the inbox.** Every security email (new sign-in, signed out, approval request) carries **[Sign out everywhere]**. It works without a session. It signs out every device, older ones included, pauses push, and needs a sign-in by link or code to come back. The first device to sign in afterwards counts as established (no 24-hour lock, 3b), and "the older device wins" starts again from it. It is a protective event and never adds to the score. Without it, a lost or stolen phone, being the older device, would keep control for a day: its holder would receive the owner's new-sign-in alerts with "Not me" and "Deny" and could sign the owner out each time, although the inbox is the credential.
- **One phone, one slot.** The installed app and the browser on the same phone count as one device for the cap, the new-device allowance and `device_churn` when they carry the same device label (for example "iPhone · Safari") and have been seen on the same network hash within 7 days. On iPhone they keep separate storage [R2][R3], so without this rule the normal path (sign up in Safari, install to the home screen for push, then use the laptop) would put an honest Standard user over a cap of 2. The Devices page shows them as one row, "iPhone (app and browser)", with one sign-out. If task 4.3d cannot match them reliably on iOS, D2's default becomes 3 signed-in devices on every plan.
- A session unused for 30 days ends (`docs/security.md`), so its slot frees itself. Sessions created by an admin impersonating a user (Better Auth marks them `impersonatedBy` [B6]) never count towards the cap or towards any signal.

**How it is built.**
- The auth module's `databaseHooks.session.create.before` and `.after` hooks [B3] call `accountIntegrity.beforeSessionCreate()` and `afterSessionCreate()`. The logic lives in the module, not in the auth config.
- Concurrent sign-ins for the same user are serialised with a transaction-level advisory lock on the user ID, so two sign-ins at the same moment cannot both pass the cap. This is a design choice; the Better Auth community pattern [B5][B14] does not lock, and issue #11073 reports sessions that survive revocation in a race when secondary storage is the only session store [B13].
- Nabvy keeps sessions in the database, as it does today.
- Better Auth's multi-session plugin is **not** used: its `maximumSessions` limits accounts per browser, not devices per user [B5].

**Revocation lag.** Better Auth documents that, with the cookie cache on, a revoked session can keep working until the cache expires [B2]. Nabvy's cache is 5 minutes (`docs/security.md`). The fix: the oRPC middleware already reads the account status on every request, and in the same transaction it now also reads `v_session_state`. That is the module's own record of each session, written by the hooks, so a revoked session is refused on its next request. Better Auth's own routes still rely on the cookie cache, so the lag there is at most 5 minutes.

### 3b. Signing in on a new device

**Identity stays email-bound.** Sign-in stays by magic link or Google (`docs/security.md`). Magic links are single-use and expire after 300 seconds by default [B7]. Sharing a magic-link account therefore means sharing an inbox or a Google account, which raises the cost of sharing. The sign-in email gains one line, with the wording for the owner to approve (D13): *"This link and code sign in whoever uses them. Don't forward them."* HBO Max warns in a similar way [S19].

**Every sign-in email carries a code as well as a link.** Nabvy turns on Better Auth's Email OTP plugin (part of `better-auth`, MIT; no new dependency) [B15]. Each sign-in email shows the link and a 6-digit code that expire together (5 minutes, 3 tries). The sign-in screen of the installed app asks for the code, because on iPhone a link opens in Safari, not in the app. Safari and the home-screen app keep separate storage [R2][R3], so a link would sign in Safari and leave the app, the only place iPhone web push works (`docs/web-app.md`), signed out. Other PWAs have met the same problem [R1]. Wherever this design says "magic link" (N1, "Not me", the 15-minute freshness check, a device signed out by the picker, strict mode or "Sign out everywhere"), it means "magic link or code".

**A recognised-device cookie, not a fingerprint.**
- A random 128-bit device ID is set in a signed, HttpOnly, Secure cookie at the first successful sign-in on a browser, following OWASP's "device cookie" pattern [S63]. It is never set on anonymous visits.
- It tells a known browser from a new one, so that alerts and approvals fire only for new devices, and it keeps the device count stable across sign-out and sign-in.
- Clearing cookies does not dodge anything: the browser simply counts as a new device (see "Step-up" below).
- **A cleared browser replaces itself.** A new device with the same label and network hash as one of the account's devices that has made no request since takes over that device's row. It is not new for the allowance, `device_churn` or the new-device alert, and the old session is ended; the 24-hour lock still applies to the new session, because its cookie is new. If the old device makes a request later, the two are counted separately again. Without this, a user whose browser clears cookies on exit, or who uses private windows, would get a new-device alert at every sign-in, use up the allowance, raise `device_churn` and fill the picker with duplicate "Windows · Chrome" rows.
- On some platforms the installed app and the browser keep separate storage, so one phone can appear as two devices. On iPhone they do [R2][R3]. "One phone, one slot" (3a) counts them as one. Task 4.3d checks the matching on iOS and Android.

**A new-device alert, for unrecognised devices only** (as Meta [S46] and Google [S44] do):

> **New sign-in to Nabvy.** Windows · Chrome, 24 Sep 14:02. Approximate area: Portsmouth (worked out from the network, so it is often wrong on mobile data or a VPN).
> If this was you, there's nothing to do. **[Not me, sign it out]** · [Sign out everywhere]

- It goes by email (Resend) and, if linked, Telegram, where "Not me" is an inline button.
- The area comes from the IP address, which Apple also calls approximate [S47] and which on mobile networks can be hundreds of kilometres out [R5]. Security alerts show it with that caveat even when the network is not settled (3d), because a stranger's sign-in is by definition on a network the account has not used, and hiding the area there would hide exactly what the payer needs to see. The picker and the Devices page, which the user reads about their own devices, show a town only for a settled network (3a). This is owner decision D24.
- "Not me" asks once: *"Sign out Windows · Chrome? If it was you, you'll need to sign in again on it."* Then it signs that device out, rotates the account's alert links and asks the account for a fresh magic link or code. The confirmation stops an honest user who sees a wrong town from signing out their own new device.
- "Not me" is a **protective** event: it never adds to the account's risk score.

**Step-up only on risk: approval from a device the user already holds.** In the normal case, the magic link or code is enough. Approval from an existing device, in the style of Apple and WhatsApp [S47][S49], is required only when one of these is true:
1. another device on the account was live in the last 30 minutes from a location 150 km or more away, seen on 2 separate days, with locations of good quality as defined in 3d;
2. the account has used up its new-device allowance for the last 30 days (3f);
3. the account's internal risk band is "watch" or higher (3d);
4. the magic link was opened 150 km or more from where it was requested, seen on 2 separate days, with locations of good quality as defined in 3d.

Conditions 1 and 4 use "good quality" locations, not only the stricter "settled" ones that score signals need (3d). A stranger's sign-in is always on a network the account has not settled, so a settled-only rule would switch these two conditions off for the very case they exist for. An approval costs one tap on a device the user holds, and the routes below always lead back in, while a score signal can lead to sign-outs. The settled-only option is owner decision D25.

**Coming back after a sign-out step.** After L1 or L3 (3e), or "Sign out everywhere" (3a), has signed devices out, the first sign-in on a device the account already knows (its device cookie is recognised) completes by magic link or code alone, with no approval. A first sign-in on an unknown device after L1 or L3 goes through as unconfirmed: the 24-hour lock applies, and the new-device alert goes to email and Telegram. Approval applies again from the next new device. Without this, an account at "elevated" after L1 would need approval (condition 3) from the one device L1 keeps, which the user may not have with them; after L3 or "Sign out everywhere" no device is left to give it, and push, one of the approval routes, is paused. A user with no Telegram link could then neither re-verify nor return when an L3 suspension ends.

The new device shows a short code:

> **Approve this sign-in on your other device.**
> We've sent a request to Nabvy on your iPhone and to your Telegram.
> Code: **4F7-K2Q** · expires in 10 minutes

The existing device (Telegram inline button, push, or an in-app banner) shows:

> **Sign-in request:** Windows · Chrome, approx. Leeds (from the network), code 4F7-K2Q. Is this you? **[Approve] [Deny]**

- **Built with Better Auth's Device Authorization plugin**, part of `better-auth` (MIT). Its device code can be pre-bound to a user ID, so only that user can approve it, and the waiting device then receives a Better Auth session token [B8]. The plugin was designed for TVs and CLIs, so task 4.3k starts with a spike. If the plugin does not fit, the fallback is a small in-house `device_approvals` table.
- **If the account has no device active in the last 30 days**, for example a lost phone, the sign-in goes through as **unconfirmed**. The 24-hour lock below applies, and the alert goes to email and Telegram.
- **Can't reach your other device?** The approval screen always shows **[I can't get to my other device]**. Once per 30 days it signs in at once as unconfirmed: the 24-hour lock applies, and the new-device alert with [Not me, sign it out] goes to email, Telegram and every other device. After that, it offers a wait instead: the sign-in completes after 12 hours unless another device denies it. The same happens when a request expires, or when every device that could approve is not yet established. After a Deny the new device shows: *"This sign-in was declined from another device on your account."* Apple, the model for this step, likewise always offers another route when trusted devices are out of reach [S25].

**The new-session lock** (Telegram's rule [S51]). A device is **established** when any of these is true:
- it was first seen on the account 24 hours ago or more;
- it signed in during the account's first 24 hours;
- it was the first device to sign in after "Sign out everywhere" (3a).

A session on a device that is not yet established cannot:
- change the email address;
- link or unlink Telegram;
- approve other devices;
- use "sign out all other devices" (the inbox's "Sign out everywhere" is not affected).

It can still take one slot at the cap. That is reversible by the older device, as described in 3a. The lock applies only to a session created while the account already had a device at least 24 hours old. Devices signed in during the account's first 24 hours count as established, so a new user can connect Telegram during onboarding (`docs/web-app.md`: postcode, default hunt, channel, first alert preview) from whichever device they are on, on the first day of the 7-day trial.

**Sensitive actions.** Changing the email, linking or unlinking Telegram, API keys, data export and account deletion need an established device (above). The billing portal (update a card, cancel, resume, invoices) works from any signed-in session with no age or freshness check; the account email is told of every change, and a cancellation can be undone until the period ends (`docs/billing.md`). Locking the portal would stop a user on a new device from fixing a failed card before the plan reverts to Free, or from cancelling a trial the day before it converts. When the internal band is "watch" or higher, the other sensitive actions also need a magic link or code completed within the last 15 minutes. That is Nabvy's own check. Better Auth's `freshAge` [B2] stays at its default for Better Auth's own endpoints.

### 3c. Channel binding

**Telegram:**
1. **Private chats only.** Handlers are registered with grammY's `chatType("private")` filter [L2]. Group joining is turned off in BotFather [S55]. If the bot is added to a group or channel anyway, the `my_chat_member` update triggers `leaveChat` at once [L3] and records a signal against the account whose linked Telegram user added it.
2. **One chat per account, and one account per chat.** `telegram_links` gets a unique constraint on the user and another on the chat.
3. **Link codes:**
   - single-use, 10-minute expiry, consumed atomically;
   - carried in the `start` parameter, which allows up to 64 URL-safe characters [S55];
   - created only from an established device (3b);
   - a used code arriving from a second chat is refused and logged.
4. **Re-links** are limited per plan: 2 per 30 days on Free and 3 on paid plans (3f, owner decision D6). A re-link unlinks the old chat, as LaunchPass does [S73]; Kodai goes further with a cool-down [S72]. Linking the same Telegram chat again, for example after `/stop` (which unlinks, `docs/web-app.md`), is not a re-link and does not count towards the allowance or `channel_misuse`. Only a switch to a different chat counts.
5. **Every alert is sent with `protect_content: true`.** This stops forwarding, saving and copying in official clients [S53][L3]; Telegram's own documentation says forwards, downloads, copying and screenshots must be disabled for such messages [R11]. It does not stop screenshots on desktop or userbots (reported) [S54]; API clients receive the protected text in full [T2]. Alerts are sent with `link_preview_options: { is_disabled: true }` and put their links only in inline buttons [L3][R20], so Nabvy's own sends never cause a preview fetch (see `relay_unfurl`, 3d).
6. **Business "channel feeds"** (backlog 5.3) stay the only way to deliver to a group, as a separate module with its own entitlement. A channel feed is the sanctioned group route, so its audience is part of its price. On install and daily, Nabvy reads the audience through each platform's official API (Discord `GET /guilds/{id}?with_counts=true` returning `approximate_member_count` [R19]; Telegram `getChatMemberCount` [L3]) and stores it with the feed. The cap or per-member price is the owner's (D21).

What the user sees: **[Connect Telegram]** opens Telegram, and the chat says *"Linked. Your alerts will arrive here. They can't be forwarded or copied; to keep or copy a deal, tap View deal."* If someone adds the bot to a group, it leaves without a message. If a user tries to forward an alert, the Telegram client refuses [S53].

**Web push:**
- Only a signed-in device can subscribe. The subscription row stores the device ID and session ID, and push devices can never outnumber the signed-in device cap.
- Signing a device out from the Devices page or the picker deletes its subscription (event `devices.revoked`, section 5). An enforcement sign-out (L1, 3e) or "Sign out everywhere" (3a) **pauses** it instead: it resumes when that device signs in again, and a subscription still paused after 30 days is deleted.
- Endpoints are treated as secrets, because knowing an endpoint is enough to send to it [L15]. Dead endpoints are removed when the push service says they are gone.
- The Devices page shows a push on/off switch for each device.

**Email alerts** go only to the verified account address, with signed links. Whether paid plans keep instant email alerts or move email to a digest is D9. Email is the easiest channel to forward.

**Signed alert links** (owned by `notification-dispatcher`, which already tracks opens "by signed link", `docs/modules.md`):
- Every "Open listing" and "View deal" button points to `nabvy.app/go/<token>`. The token carries the alert ID, the channel, a per-user key version and an HMAC.
- The token **never creates a session** [S77].
- **Opener allowance.** A token always opens the deal for any signed-in session of the recipient. Anyone else gets it only as one of the first 3 distinct openers within 7 days of delivery. An opener is the device cookie when there is one. Otherwise it is browser family plus OS plus network hash, with a browser's IPv4 and IPv6 requests within 10 minutes merged. Later openers see *"Sign in to see this deal."* with [Sign in] (wording for D13), and the open is still logged. This is product behaviour, the same for everyone, and it never adds to a score by itself. Without it, a forwarded link gives full value to anyone who holds it until the links are rotated, and rotation happens only after detection, so a whole alert pasted into a 20-person Discord would work for all 20.
- **Nothing for machines.** `/go/<token>` returns a small page with no Open Graph tags and no destination in the markup. A first-party script on the page records the open and then replaces the location. HEAD requests, requests that never run the script, and known preview or mail-scanner agents are logged as `prefetch`. They never count as openers, opens or fan-out. Corporate mail gateways can scan every link before the message is delivered [R12], and email marketers report such scanner fetches being recorded as clicks (reported) [R13]; without this rule, every email alert to an Outlook business mailbox could look like fan-out.
- Each open is logged with: a keyed hash of the network prefix (/24 for IPv4, /48 for IPv6), the town from Vercel's headers, the browser family, the device cookie if present, the signed-in user if any, the opener key, whether it was an open or a `prefetch`, and the seconds since delivery. This follows the per-subscriber link pattern of Stratechery and Mailchimp [S75][S76].
- **Rotation:** bumping the user's key version makes old links show "This link has expired. Sign in to see the deal." Stratechery resets feeds in the same way [S75].
- **Tolerance:** a deal forwarded to one or two friends opens normally for them and is not a signal [S75].
- The Facebook URL is not printed in alert text, because the signed link replaces it (D8).

**Optional: invisible variation for each recipient** (off by default, D10). Alert templates choose between equivalent layouts using bits from an HMAC of the user and the alert: field order, emoji variant and separators. An admin decoder then maps leaked text or a screenshot back to candidate accounts. The discourse-watermarking project describes the approach and its limits: retyping or photographing the screen defeats it [S78].
- Prices, facts and wording stay identical.
- No zero-width characters, because they can upset screen readers and copy-paste [S78].
- Never a fabricated deal.

### 3d. Detection signals and the internal risk score

Everything in this section is internal. None of it is shown or told to any user, in any channel.

**Inputs, all server-side:**
- **Vercel request headers:** `x-real-ip` and `x-vercel-ip-country`, `-country-region`, `-city`, `-latitude` and `-longitude`, as named in `@vercel/functions` [V1]. Vercel's documentation says these headers stop working behind another proxy [V2], so `nabvy.app` stays DNS-only on Cloudflare (D15).
- **Device labels** from Next.js's built-in `userAgent()` [V3].
- **Module events:** sessions, lease events, device approvals, and the dispatcher's alert-open context.

**What is stored:** a keyed hash of the IP prefix, the country, region and town, and coordinates rounded to 0.1°. Raw IPs are not copied out of Better Auth's session table.

**Location quality.** A town worked out from an IP address is often wrong, and wrongest for the people Nabvy serves:
- on mobile networks an address "may move between users who are hundreds of kilometers away from each other over the course of even a few minutes" [R5], and a 2026 study reports mobile median errors of 179–207 km against 3–16 km on fixed networks [R9];
- iCloud Private Relay can widen the location to the country and time zone [R7], and Apple advises treating its addresses "like larger carrier-grade NAT" [R6];
- Entra's impossible-travel detection ignores VPNs and locations regularly used by other users [S56].

So every location gets one of three grades:
- **Unknown:** an address in Apple's published Private Relay egress list [R8], which carries the country only (the list is refreshed daily); or any location of a device that has appeared in two places 150 km or more apart within the hour (VPN switching or a mobile gateway), for that hour.
- **Good quality:** any other location. Used only by step-up conditions 1 and 4 (3b), where the cost of a mistake is one approval.
- **Settled:** a network hash seen at the same town on 3 or more separate days in the last 30, and never at a town 50 km or more away within the same 24 hours.

How the grades are used:
- A location counts towards `concurrent_distant`, `impossible_travel`, `lease_pingpong` and `magic_link_cross` only when it comes from a settled network. Every other location is "unknown" for these signals and never counts as distance.
- `impossible_travel` compares consecutive activity of the same device only, never two devices.
- Distance between two devices that have both been on the account for 7 days or more is never a signal on its own, because one live screen already stops them being used together (see the couple fixture in 7.1). `concurrent_distant` counts only when one of the two devices is younger than 7 days, or when the two contest the live screen with "Use here".
- The first critique also proposed that a town seen on 3 or more days should be "familiar" and never count as distant. It is not adopted: it is the opposite of the settled rule, and together they would switch distance off entirely. The 7-day device rule covers the case it was meant for, a laptop that exits through the same VPN every day.

**Never used:** GPS, scan mode's location permission, hunt postcodes, PostHog data.

**Signals (internal catalogue; starting thresholds, tuned in shadow mode):**

| ID | Signal | Starting definition | Weight | Pattern from |
| --- | --- | --- | --- | --- |
| `concurrent_distant` | Sessions active at the same time from distant networks | Two devices with requests in the same 15-minute window, 150 km or more apart, seen on at least 2 days within 14. Settled locations only, and only when one of the two devices is younger than 7 days or the two contest the live screen with "Use here" (Location quality, above) | 25 | Unusual Whales [S70]; Entra [S56]; OpenAI flags "more simultaneous logins than usual" [S32] |
| `impossible_travel` | Speed between consecutive activity of the same device | Over 800 km/h across more than 300 km, after a 7-day learning period, between settled locations only. Shorter hops are ignored as IP-location noise | 20 | Defender, Entra [S56][S57] |
| `lease_pingpong` | Live screen contested back and forth | 6 or more "Use here" takeovers a day, where both screens were visibly live (3a), between devices on settled networks 50 km or more apart. Silent takeovers are one person moving between devices and never count | 15 | TradingView takeover counts [S67] |
| `link_fanout` | One alert opened by many people | 3 or more distinct openers (as defined in 3c) that ran the `/go/` script, within 30 minutes of delivery, on 3 or more alerts in 7 days. Prefetches never count. Opens by this account's own devices (device cookie or signed-in session) never count, whatever network they come from, and nor do opens by clients that `userAgent()` marks as bots [V3] | 20 | Stratechery, Mailchimp [S75][S76] |
| `foreign_opener` | Alerts opened on devices signed in to other Nabvy accounts | 3 or more distinct alerts in 7 days, each opened by 2 or more devices signed in to other Nabvy accounts, from 2 or more other accounts in all. Never counted: an open without a device cookie; a device that is also one of this account's own; an account whose devices were on one of this account's settled networks on 3 or more days in the last 30 (a household member). An alert opened by only one such device falls under the single-deal tolerance (3c) | 20 | Design choice. Weight and hard-rule use: owner decision D23 |
| `device_churn` | Too many devices | Distinct devices in 30 days of cap + 3 or more, counting an installed app and its browser as one device (3a) | 15 | Apple's swap wait [S48]; Figma's range of signals [S35] |
| `channel_misuse` | Telegram re-links, group adds, a reused code | Over the re-link allowance (linking the same chat again is not a re-link, 3c); the bot added to a group; a code used from a second chat | 15–25 | Kodai, LaunchPass [S72][S73] |
| `magic_link_cross` | Link opened far from where it was requested | 150 km or more apart within 5 minutes, between settled locations only | 10 | Design choice |
| `magic_link_spread` | Magic links requested from many networks | 4 or more distinct networks in 24 hours | 10 | Design choice |
| `relay_unfurl` | Alert link fetched by a chat app's preview crawler | `/go/` requests whose user agent contains `Discordbot`, `Slackbot-LinkExpanding`, `TelegramBot`, `facebookexternalhit` or `WhatsApp`, on 10 or more distinct alerts in 7 days. Slack documents its crawler [T6]; Discord's agent string is in an open, unmerged pull request to its documentation [T5]; the Telegram and Facebook (WhatsApp preview) agents are reported by user-agent directories, not documented by the companies [R14] | 30 | Slack's crawler documentation [T6]; Discord's documentation pull request [T5] |
| `machine_opener` | Alert links opened by a script | 80% or more of delivered alerts opened within 5 seconds of delivery, in 18 or more distinct clock hours over 7 days; or 10 or more opens in 7 days that never run the `/go/` script | 25 | Design choice |
| `live_marathon` | One live screen kept visible round the clock | Lease held with its surface visible for 18 or more hours in 24, on 3 or more days in 7 | 15 | Discord Go Live allows up to 50 viewers of one stream [T4] |
| `area_local_openers` | Areas used by different people | 2 or more of the account's areas (cells, never postcodes) 150 km or more apart, each with 5 or more opens in 14 days from a different device. That device's settled town is within 40 km of that area, and it never opens alerts for the other areas | 25 | Areas per plan, `docs/billing.md` |
| `automation` | Non-human pace | Counts only user-initiated requests (search, filter changes, deal opens, hunt edits). Lease heartbeats, releases and client-scheduled refreshes never count. Fires on any of: a non-browser user agent, or `userAgent().isBot` [V3]; more than 20 feed, map or search requests in an hour from a device without the live lease; user-initiated requests above the per-user rate limits; user-initiated requests at a steady interval (gaps varying by less than 10%) for 6 hours | separate track | GitHub Copilot's "excessive or automated usage" (reported) [S41] |
| `evasion_match` | Links to a banned account | A normalised-email hash, card fingerprint (from billing's view), device key, Telegram user-ID hash or hunt-set hash that matches a banned account. Emails are normalised before hashing: lower case; the part after "+" removed; for gmail.com and googlemail.com, dots removed and the domain set to gmail.com [R15]. The hunt-set hash is the sorted set of (product key, cell), taken only for accounts with 8 or more active hunts; a match is a Jaccard similarity of 0.8 or more. Applies only to accounts created, and payment cards added, after the ban being matched. For an account that existed before that ban, a card or device match is recorded for admins and applies nothing automatically | hard rule on normalised email or card fingerprint; weight 30 for a device-key or hunt-set match alone (3e) | `docs/decisions.md`, ban evasion; a card fingerprint "uniquely identifies this particular card number" [R17] |

**Relay-class signals** are `relay_unfurl`, `machine_opener`, `link_fanout`, `foreign_opener`, `area_local_openers` and `channel_misuse` (3e).

**Why `foreign_opener` changed.** As first drafted (2 opens in 7 days, weight 35, a hard rule for a ban), it would have signed out, and then banned, a payer whose partner has their own account and opens forwarded deals on a shared family iPad, and an iPhone user whose alerts open in Safari or an in-app browser, neither of which holds the installed app's cookie [R3][R4]. Both critiques agreed it had to change; they differed on how far. This version takes the lower weight (20, so it reaches "watch" at most on its own), drops it from the hard rules, and keeps the household and single-deal exclusions. A relay still escalates through the other relay-class signals and the relay entry at L2 (3e). The stronger option is owner decision D23.

**Why the automation signal changed.** As first drafted, a steady interval with no idle gaps would have fired on Nabvy's own client: the lease heartbeat every 30 seconds, and machine-paced feed refreshes, on a feed kept on a second monitor all working day.

**The score.**
- Score = min(100, Σ weight × strength × decay). Strength is between 0 and 1, and decay halves the contribution every 14 days.
- **Each kind of signal contributes at most twice its weight.** A single kind repeated every day therefore cannot push an account to "elevated" on its own; that takes at least two different kinds, or `relay_unfurl`.
- **Bands:** 0–29 normal; 30–59 watch (new devices need approval); 60–79 elevated; 80–100 high.
- **Near-real-time rules** run every 5 minutes as a Trigger.dev batch over accounts that had, in the last 15 minutes, a request from one of their devices, an alert delivered, or an open or preview fetch of one of their alert links: `concurrent_distant`, `link_fanout`, `foreign_opener`, `relay_unfurl`, `channel_misuse`, `automation`.
- **A nightly batch** at 02:30 rescores every account with a session, an alert delivered or an alert-link open in the last 30 days, in batches of 500, and computes `impossible_travel`, `device_churn`, `machine_opener`, `live_marathon` and `area_local_openers`. Selecting accounts by deliveries and link opens, not only by device requests, matters for relays: a payer who relays Telegram alerts by script may never open the app, and the group's opens are not on the payer's devices.

**Tolerances**, to keep false positives low:
- **Location quality** (above): distance signals use settled locations only.
- **A 7-day learning period** for each new account before travel signals (`concurrent_distant`, `impossible_travel`) count, as Microsoft does [S56].
- **No single event acts.** Figma looks at "a range of signals ... rather than enforcing a single concurrent-session limit" [S35]. OWASP notes that NAT and mobile networks limit what IP binding shows [S62]. Every distance signal therefore needs repetition on different days.
- **A known-traveller allowlist**, set by an admin and time-limited.
- **The account's own "Not me" events** never add to its score.

### 3e. The automatic enforcement ladder

This is the owner's "Fair use, suspension and bans" decision put into operation.
- Each step is **applied automatically** by rule, with a row in `enforcement_actions` holding the rule ID and version, the score, the IDs of the evidence signals and the notice sent, and an `audit_log` row written through ops-monitor with the actor `system:account-integrity`.
- The user sees **only the fixed notice** for that step.
- Admins can see, override and lift everything, and each of those actions is audited.

| Step | Triggered when (internal) | Applied automatically | What the user sees (draft wording, owner decision D13) | How it ends |
| --- | --- | --- | --- | --- |
| **L0 Watch** | Band "watch" | Nothing visible. New devices need approval (3b) | Nothing | Score decays |
| **L1 Re-verify** | First time in band "elevated" | The sessions of the devices named in the evidence signals are revoked, except the account's longest-established device (the one with the most active days in the last 30), which stays signed in; the owner's "auto log off", used here as a targeted step. Push subscriptions of revoked devices are paused, not deleted, and resume when that device signs in again; a subscription still paused after 30 days is deleted. Alert links are rotated. The account is marked for re-verification. The Telegram link stays | **N1:** "Please sign in again on your other devices to keep using Nabvy there." (by email, as a banner on the device that stays signed in, and as one push or Telegram message) | Clears itself when the user signs in again by magic link or code on a device the account knows, or completes a link or code from the banner on the device that stayed signed in; that sign-in never needs approval (3b) |
| **L2 Limit** | "Elevated" again within 30 days of L1, or "high"; or the relay entry below | For 7 days: 1 signed-in device (strict mode); alerts to one channel only; the hourly alert cap lowered (router default 20 → 6); no new hunts; Telegram re-links frozen; every new device needs approval. The channel kept is the one that delivered the most alerts in the last 7 days. If it is web push, strict mode never signs out that push device: another device may be signed in alongside it only with approval from it. Every action L2 blocks (a new hunt, a Telegram re-link, a new device) shows N2 in place, with its end date, instead of an error. **Alerts are never delayed** | **N2:** "Some features on your account are limited until 1 October under our terms." (banner and one email) | Ends on a fixed date 7 days after it starts. New signals during L2 count towards L3 under the rule below the table; they never extend L2 silently |
| **L3 Suspend** | "High" during L2 or within 60 days of it | Account status `suspended` until a date (7 days the first time, 30 days the second); all sessions revoked; no alerts; the account's hunts no longer count as demand for collection; billing unchanged (D12) | **N3:** "Your account is suspended until 3 October under our terms." (at sign-in and by email) | Lifts itself at the date. The user signs back in by magic link or code; a device the account knows needs no approval (3b) |
| **L4 Ban** | "High" within 180 days after an L3, or a hard rule: `evasion_match` on normalised email or on card fingerprint (the owner's rule), for accounts created or cards added after the ban (a device-key or hunt-set match alone adds weight 30 but is not a hard rule); `machine_opener` and `relay_unfurl` both at full strength on 7 or more days in 14 | Account status `banned`; Better Auth `banUser` revokes the sessions and blocks sign-in [B6]; the subscription is cancelled at once with no refund (existing owner decision); evasion keys are stored; the Telegram chat is unlinked and blocked from linking to another account; hunts are deactivated | **N4:** "Your account has been closed under our terms." (at sign-in and by email) | Permanent. An admin can lift it (audited) |

- **Which signals can go past L1.** L2, L3 and L4 need at least one signal that shows another person or a machine: the relay-class signals (`relay_unfurl`, `machine_opener`, `link_fanout`, `foreign_opener`, `area_local_openers`, `channel_misuse`), `lease_pingpong` (contested "Use here" takeovers only, 3a), `automation` or `evasion_match`. Signals about one person's own devices, places and screen time (`concurrent_distant`, `impossible_travel`, `device_churn`, `magic_link_cross`, `magic_link_spread`, `live_marathon`) can lead at most to L1 and to approval on new devices. Without this rule, an honest user flagged by location or device-count signals would keep producing the same signals, because the vague notice cannot tell them what to change, and L2 would roll on into a suspension. That is the backlash recorded for Keepa [S71], Unusual Whales [S70] and Adobe [S31].
- **L1 is targeted.** Signing out every device, as first drafted, would have stopped push alerts without warning for a payer who relies on them, and made them turn push on again device by device. The step that worked for Netflix fell only on the device that looked like a borrower [S11][S12].
- **Relay-class evidence starts at L2.** When relay-class signals make up more than half of the score that reaches "elevated", the first step is L2, not L1. Re-verification removes borrowers from a shared login, but it costs a relay one magic link, because the Telegram link and email alerts carry on through L1. The lower hourly alert cap at L2 is the first step a relay feels.
- **Pacing:** no more than one automatic escalation in any 24 hours, except for hard rules. Ninety clean days step the history back one level.
- **Automation track:** rate limits answer with HTTP 429 at once. Persistent automation goes to L2 and then L3.
- **The ban message:** Better Auth's default ban message, and its documented example that shows `banReason` [B6], are replaced with the fixed N4. `banReason` holds only an opaque action ID, never a reason.
- **Contact route:** every notice links to a generic "Contact us" form. Big tech offers a similar route (for example YouTube's form to confirm eligibility before a pause, reported [S5]), which the owner's decision allows, and it reveals nothing. Support replies use fixed templates. Admins decide internally.
- **Why step up in this order:** L1 and L2 are the steps big tech uses to *cure* sharing, because the fix removes the borrowers [S34][S20]. This holds for shared logins; relays start at L2. L3 and L4 are kept for repeat or commercial cases, as GitHub and LinkedIn do [S37][S41].

### 3f. Limits by plan

These defaults are for the owner to decide (D1, D2, D4, D6). Plan names follow `docs/billing.md`.

| Limit | Free | Standard | Pro | Business (per seat) |
| --- | --- | --- | --- | --- |
| Signed-in devices | 2 | 2 | 3 | 3 |
| Live screens at once | 1 | 1 | 1 | 1 |
| Telegram chats (private) | 1 | 1 | 1 | 1, plus channel feeds (5.3), with an audience cap or per-member price (D21) |
| Push devices | up to the device cap | up to the device cap | up to the device cap | up to the device cap |
| New devices per 30 days before approval is needed | 3 | 4 | 5 | 5 |
| Telegram re-links per 30 days | 2 | 3 | 3 | 3 |
| Public API keys | none | none | none | per seat, 600 requests a minute (`docs/engineering.md`) |

**A paid extra seat (owner decision D5).**
- **What it is:** a second person with their own login, their own live screen, their own Telegram chat and their own hunts, billed to the payer. Netflix [S9], Disney+ [S17] and LinkedIn Premium Duo [S38] offer the same route.
- **Why:** big tech's lesson is to offer a paid route at each step (1.3).
- **How it would be built:** Better Auth's Stripe plugin supports seats, and per-seat prices need its organization plugin [B11].
- **Default if the owner does not decide:** the design leaves room for seats, and none is sold at launch.

### 3g. What this design does not stop

| Route | Why it gets through | What still limits it |
| --- | --- | --- |
| Retyping or screenshotting item, price and town into Discord | Anything shown can be copied; members search Facebook for the listing | Areas, hunts, the hourly alert cap |
| Opening each alert once and posting the Facebook address | One opener per alert looks like the payer | `machine_opener` if scripted; the alert cap |
| One Telegram account shared by the group, signed in on every member's phone [T1] | Nabvy sees one private chat | The alert cap; invisible to the bot |
| A userbot or API client on the payer's Telegram posting to a Discord webhook | API clients receive protected messages in full [T2][S54] | `machine_opener`, `relay_unfurl`, the alert cap |
| Email auto-forwarded to a webhook; push read by an Android notification-listener app [T3] | Delivery is to the payer's own inbox or device | Areas and the alert cap only |
| One live screen streamed with Discord Go Live, up to 50 viewers [T4] | The lease limits screens in use, not people watching one | `live_marathon` |
| A shared VPN exit for a shared login | Every distance signal sees one place | Device cap, `device_churn`, one live screen |
| New accounts with fresh emails and cards | See `evasion_match` and D22 | Each new paid account is revenue; no refunds |

---

## 4. The open-source stack

Licences were checked on 2026-09-24 against the repository `LICENSE` files and npm metadata. The versions and licences in this table were re-checked on the npm registry on 2026-09-24.

| Need | Choice | Version | Licence | New dependency? | Notes |
| --- | --- | --- | --- | --- | --- |
| Sessions, list and revoke, hooks, freshness | `better-auth` core [B1][B2][B3] | 1.7.5 | MIT | No, already in the stack | `databaseHooks.session.create.before/after`, `listSessions`, `revokeSession`, `revokeOtherSessions`, `revokeSessions` |
| Ban, time-limited ban, admin revoke | Better Auth admin plugin [B6] | 1.7.5 | MIT | No | Fixed `bannedUserMessage`. `banReason` holds only an opaque ID |
| Approval from an existing device | Better Auth Device Authorization plugin [B8] | 1.7.5 | MIT | No (in the core package) | Spike in 4.3k; in-house fallback |
| Sign-in code alongside the magic link | Better Auth Email OTP plugin [B15] | 1.7.5 | MIT | No (in the core package) | 6-digit code, 300-second expiry, 3 attempts; lets the installed iPhone app sign in (3b) |
| Rate limits on auth endpoints | Better Auth rate limiter with `storage: "database"` and `ipAddressHeaders: ["x-real-ip"]` [B9] | 1.7.5 | MIT | No | Memory storage is not suitable on serverless [B9] |
| Captcha on magic-link and sign-in-code requests | Better Auth captcha plugin with Turnstile, magic-link and email-OTP endpoints listed in `endpoints` [B10] | 1.7.5 | MIT | No | By default it covers only email-and-password endpoints [B10], so `docs/security.md`'s Turnstile on magic links needs this setting |
| IP and town | Vercel request headers [V1][V2] | none | none | **No.** A small header reader in the module | `@vercel/functions` 3.9.9 (Apache-2.0) is allowed if its helpers are preferred |
| Device labels | Next.js `userAgent()` [V3] | ships with Next.js 16 | MIT | No | `bowser` 2.14.1 (MIT) [L9] is an allowed alternative |
| Telegram | `grammy` [L1][L2][L3] | 1.46.0 | MIT | No | `chatType("private")`, `protect_content`, `leaveChat`, `my_chat_member` |
| Push sending | `@pushforge/builder` [L5] **instead of** `web-push` | 2.0.5 | MIT | Yes, in place of `web-push`, which is named in `docs/architecture.md` and `docs/secrets.md` but not installed (D14) | `web-push` 3.6.7 is **MPL-2.0** [L4], which `CLAUDE.md` does not allow. Task 4.2 has not started and no `package.json` or `pnpm-lock.yaml` lists `web-push`, so task 4.2a names the MIT sender in the docs before any push code is written. VAPID keys come from `npx @pushforge/builder vapid` (private key as a JWK) [L5] |
| Service worker | Serwist | already in the stack | MIT | No | |
| Velocity counters | In-house Postgres counters (`docs/engineering.md`, "Rate limits and abuse") | none | none | No | `rate-limiter-flexible` 11.2.1 (ISC) [L10] is an allowed alternative if the platform middleware adopts it |
| Distance | In-house haversine in `src/domain` | none | none | No | Pure and testable. PostGIS is not needed here |
| Risk rules and ladder | In-house | none | none | No | No widely used fraud or risk-scoring engine was found under an allowed licence (those found are in the table below). General rules engines under allowed licences exist, for example `json-rules-engine` 7.3.1 (ISC) [L16]. The signals in 3d are few and typed, so pure functions in `src/domain` are simpler, and no engine is adopted |

**Built in-house** (in `services/account-integrity`):
- the device cookie;
- the session mirror;
- the live-screen lease;
- the cap and picker logic;
- the signal rules;
- the score;
- the ladder and notices;
- the admin views;
- the evasion keys;
- the fixtures.

`notification-dispatcher` adds the signed-link route. `account` adds the Telegram and push binding rules.

**Is device fingerprinting needed? Not for version 1.**
- The first-party device cookie [S63] counts devices reliably until it is cleared. Clearing it only makes the browser count as new, which uses up the new-device allowance and brings in approval. Clearing cookies therefore adds friction for the evader and gives no escape.
- Fingerprinting would add two things only: recognising a device after its cookies are cleared, and linking devices across accounts for ban evasion.
- Its accuracy is limited:
  - FingerprintJS's own README says the open-source build is "significantly" less accurate than its commercial product [L6];
  - ThumbmarkJS reports about 80% uniqueness and more collisions on Macs and Safari [L7];
  - Safari 26 is reported to reduce fingerprint stability [L14].
- **If shadow data later shows evasion by clearing cookies**, the allowed choice is `@fingerprintjs/fingerprintjs` **5.2.0 (MIT)** with `monitoring: false`, because its npm build otherwise sends usage requests that include the client IP [L6]. It would be a weak signal only, never the sole basis for an action. `@thumbmarkjs/thumbmarkjs` 1.11.0 (MIT) with `logging: false` is the alternative [L7]. This is owner decision D16, and it is also a legal item.

**Not allowed, or not used:**

| Library | Licence or reason | Status |
| --- | --- | --- |
| FingerprintJS v4.x | BUSL-1.1, source-available [L6] | Not allowed. Pin ^5 if ever used |
| `ua-parser-js` v2.x | AGPL-3.0-or-later (2.0.10, npm, checked 2026-09-24) [L8] | Not allowed. v1.x is MIT but not needed |
| `web-push` 3.6.7 | MPL-2.0 [L4] | Not allowed under `CLAUDE.md`. Named in the docs but never installed; task 4.2a names `@pushforge/builder` instead (D14) |
| tirreno, Jube | AGPL-3.0 [L11] | Not allowed |
| Marble | Elastic License 2.0 [L11] | Not allowed |
| Keygen | Fair Core License, source-available [L12] | Not allowed |
| MaxMind GeoLite2 data | Proprietary EULA since 30 Dec 2019 [L13] | Not used; Vercel's headers are enough |
| `@upstash/ratelimit` | MIT, but adds a new vendor (Upstash Redis) | Not used |
| Better Auth multi-session plugin | Limits accounts per browser, not devices per user [B5] | Not used |
| Passkeys (`@better-auth/passkey`, MIT) | Can be shared through Apple's shared password groups [S66] | Optional later, for convenience; not an anti-sharing control |
| Chrome Device Bound Session Credentials | Generally available only in Chrome on Windows since April 2026 [S65] | Watch list |

---

## 5. Data model and module contract

**Where it lives:**
- `services/account-integrity/`, created with `pnpm new:module account-integrity`;
- contracts in `packages/contracts/src/modules/account-integrity.ts`;
- tables in `packages/db/src/schema/account-integrity.ts`, in the Postgres schema `account_integrity`;
- migrations in `packages/db/migrations/account-integrity/`, with `dependsOn: ["core"]`.

All tables carrying a `user_id` get `enable_user_rls`. User-facing reads go through `security_invoker` views with an explicit column allowlist (`packages/db/README.md`).

### 5.1 Tables (owned and written only by account-integrity)

| Table | Holds | Key columns | Proposed retention (D17) |
| --- | --- | --- | --- |
| `devices` | Browsers that have signed in | `id`, `user_id`, `device_key_hash`, `label` ("iPhone · Safari · app"), `first_seen_at`, `last_seen_at`, `approved_at`, `approved_by_device_id`, `revoked_at` | While the account exists; 90 days after revocation |
| `sessions` | Mirror of Better Auth sessions (Better Auth deletes a session row when it is revoked) | `session_id`, `user_id`, `device_id`, `created_at`, `last_seen_at`, `revoked_at`, `revoke_cause`, `unconfirmed`, `impersonated` | 90 days after the session ends |
| `activity_buckets` | Coarse activity, written at most once per device every 5 minutes | `user_id`, `device_id`, `bucket_start`, `network_hash`, `country`, `region`, `town`, `lat_01`, `lng_01`, `request_count` | 90 days |
| `live_leases` | The current holder of each live screen | `user_id`, `slot`, `device_id`, `session_id`, `acquired_at`, `heartbeat_at` | Current rows only |
| `lease_events` | Takeovers | `user_id`, `from_device_id`, `to_device_id`, `kind` (silent or use_here), `at`, `network_hash` | 90 days |
| `device_approvals` | Step-up requests (if the plugin is not used) | `id`, `user_id`, `pending_device_id`, `code_hash`, `requested_at`, `expires_at`, `approved_by_device_id`, `approved_at`, `denied_at` | 30 days |
| `signals` | Detected signals | `id`, `user_id`, `kind`, `strength`, `window_start`, `window_end`, `evidence` (IDs of rows in this module and of dispatcher opens), `rule_id`, `rule_version`, `observed_at`, `detected_at`, `idem_key` (unique) | 180 days |
| `risk_scores` | Current score per account | `user_id`, `score`, `band`, `components`, `scored_at`, `score_version` | Current row plus 180 days of history in `risk_score_history` |
| `rules` | Rule versions, thresholds and the mode of each rule (`shadow`, `soft` or `hard`) | `rule_id`, `version`, `thresholds`, `mode`, `changed_by`, `changed_at` | Kept |
| `enforcement_actions` | Every ladder step, whether applied or recorded in shadow | `id`, `user_id`, `step`, `mode` (shadow, soft or hard), `rule_id`, `rule_version`, `score`, `signal_ids`, `notice_id`, `applied_at`, `expires_at`, `lifted_at`, `lifted_by` (`auto` or admin ID), `automatic`, `observed_at`, `detected_at`, `scored_at`, `notified_at`, `idem_key` (unique) | While the account exists, plus 12 months after the last action ends |
| `account_status` | The owner's account status plus current restrictions | `user_id`, `status` (active, suspended or banned), `suspended_until`, `reverify_required`, `max_devices_override`, `alert_channels_limit`, `alert_hourly_cap`, `hunts_frozen`, `channels_frozen`, `current_action_id` | While the account exists |
| `admin_overrides` | Admin lifts, limit changes, allowlists | `id`, `user_id`, `admin_id`, `kind`, `note`, `created_at`, `expires_at` | As `enforcement_actions` |
| `action_labels` | Admin verdicts on actions, used to measure false positives | `action_id`, `admin_id`, `verdict` (correct, wrong or unsure), `at` | Kept, with no free-text personal data |
| `evasion_keys` | Keys of banned accounts, and of accounts that have had a free trial | `kind` (email, card, device, telegram, hunt_set, trial_email, trial_card, trial_device), `value_hash` (keyed HMAC; emails normalised first, 3d), `user_id`, `banned_at` (ban kinds) or `trial_at` (trial kinds) | Ban kinds while the ban stands; trial kinds as D17 decides |

**New secrets** (to be added to `docs/secrets.md` in task 4.3c):
- `INTEGRITY_HASH_SECRET`, for network and evasion hashes;
- `DEVICE_COOKIE_SECRET`;
- `ALERT_LINK_SECRET`, owned by the dispatcher if it does not already have one.

**New config** (`@nabvy/config`):
- `ACCOUNT_INTEGRITY_MODE` = `off`, `shadow`, `soft` or `hard`;
- the plan limits in 3f;
- the lease timings.

### 5.2 Views

| View | Readers | Columns (allowlist) |
| --- | --- | --- |
| `v_account_status` | The oRPC middleware and every job that acts for a user: opportunity-router, notification-dispatcher, crawl-planner, billing-entitlements, marketing | `user_id`, `status` (computed so that timed statuses expire by themselves), `until`, `reverify_required`, `max_devices`, `alert_channels_limit`, `alert_hourly_cap`, `hunts_frozen`, `channels_frozen`. **No reason, rule, signal or score** |
| `v_session_state` | The oRPC middleware | `session_id`, `user_id`, `state` (active or revoked) |
| `v_my_devices` | The user's own Devices page (RLS: own rows) | `device_id`, `label` (an installed app and its browser merged as one row, 3a), `town` (null unless the network is settled; the page shows "approx. <town>" or "location unknown"), `last_active_at`, `is_current`, `has_push`, `is_live`, `can_sign_out` |
| `v_my_limits` | The user's own Devices page | `devices_used`, `devices_allowed`, `live_screens_allowed`. These are plan limits, not detection rules (D3) |
| `v_integrity_metrics_daily` | ops-monitor dashboards | Daily aggregates only (section 7) |
| `v_admin_integrity_cases` | Admin procedures only | `user_id`, email, plan, score, band, open actions, last signal, overrides |
| `v_admin_integrity_timeline` | Admin procedures only | Per account: devices, sessions, towns, lease events, signals with evidence, actions, notices, overrides |
| `v_admin_integrity_rules` | Admin procedures only | Per rule and version: would-be and applied actions by step, labelled precision, honest-cohort hits |

The admin views are granted only to the role used by the admin procedures, never to ordinary `nabvy_app` requests. Admin pages live at `/admin/integrity`, with three views:
- **cases**, sorted by score;
- a **case timeline** with a map at town level;
- **rules**.

Admins can lift, extend, override limits, allowlist a traveller for a set number of days, apply an action by hand, and label actions. Every action, and every opening of a case, writes `audit_log` through ops-monitor's exported function.

### 5.3 Events (thin: IDs and timestamps only; batch payloads)

| Event | Emitted by | Payload | Consumed by |
| --- | --- | --- | --- |
| `account.status_changed` | account-integrity | `userIds[]`, `at` | opportunity-router (stop or cap matches), notification-dispatcher (stop or limit delivery), crawl-planner (suspended or banned hunts stop counting as demand), billing-entitlements (a ban cancels the subscription), marketing (suppression), hunt-manager (freeze) |
| `devices.revoked` | account-integrity | `userId`, `deviceIds[]`, `push` (`delete` or `pause`), `at` | account (deletes push subscriptions for those devices, or pauses them after an L1 or "Sign out everywhere"; a subscription still paused after 30 days is deleted) |
| `alert_links.rotate_requested` | account-integrity | `userIds[]`, `at` | notification-dispatcher (bumps each user's link key version) |
| `alert.delivered`, `alert.opened` | notification-dispatcher (existing) | `alertId` | account-integrity (loads open context from `v_alert_open_context`) |
| `channel.linked`, `channel.unlinked` (new) | account | `userId`, `channel`, `at` | account-integrity |
| `entitlement.changed` | billing-entitlements (existing) | `userId`, `tier` | account-integrity (recomputes limits) |

Idempotency keys: `signals.idem_key = rule_id|rule_version|user_id|window_start`, and `enforcement_actions.idem_key = user_id|step|rule_id|window_start`. Every handler is safe to run twice, following the principle of `CLAUDE.md`'s listing key. The stamps on each action (`observed_at`, `detected_at`, `scored_at`, `applied_at`, `notified_at`) give the detection latency.

### 5.4 Exported functions (called in-process, never over HTTP)

| Function | Called by | Behaviour when mode is `off` |
| --- | --- | --- |
| `beforeSessionCreate(input)` → `allow`, `approve_required` or `deny(noticeId)`; `afterSessionCreate`; `onSessionRevoked` | The auth module's Better Auth hooks | `allow`; the mirror is still written (cheap) |
| `getStatus(userIds[])` | oRPC middleware, jobs | Reads the view |
| `acquireLease`, `heartbeat` | oRPC procedures for the feed, map and search | Always granted |
| `checkChannelBinding(userId, kind, deviceId)` | account (Telegram link, push subscribe) | `allow` |
| `signOutEverywhere(emailToken)` | A public route behind the security emails' [Sign out everywhere] (no session needed; the token is single-use and signed) | Works normally |
| `checkTrialKeys(userId)` | billing-entitlements (subscription-created hook, D22) | `allow` |
| `listMyDevices`, `signOutDevice`, `signOutOtherDevices`, `requestApproval`, `approve`, `deny` | oRPC procedures under `apps/web/src/rpc/account-integrity.ts` | Work normally, without caps |
| `admin.*` (cases, timeline, lift, override, label, set rule mode) | Admin oRPC procedures | Work normally |

User-facing outputs use separate Zod schemas that have no reason, rule or score fields. The CI test from `docs/decisions.md` scans rendered notices, emails, Telegram texts and API responses for rule IDs, signal kinds and score fields.

### 5.5 Changes other modules make (one pull request per owning module)

- **auth:**
  - hooks that call the module;
  - a fixed `bannedUserMessage`;
  - rate-limit storage `database` with `ipAddressHeaders: ["x-real-ip"]`;
  - the captcha plugin's `endpoints` to include the magic-link and email-code requests;
  - the Email OTP plugin, so every sign-in email carries a link and a code (3b);
  - the Device Authorization plugin, if the spike passes.
- **account:**
  - unique constraints on `telegram_links` (user and chat);
  - single-use, expiring link codes;
  - a `device_id` and `session_id` on each push subscription;
  - calls to `checkChannelBinding`;
  - the `channel.*` events;
  - consuming `devices.revoked`.
- **notification-dispatcher:**
  - private-only sends with `protect_content`;
  - `/go/<token>` as a script page with the opener allowance, and open context (including the opener key and `prefetch` marks) in an `alert_opens` table and a `v_alert_open_context` view;
  - `link_preview_options: { is_disabled: true }` on every Telegram send, with links only in inline buttons;
  - per-user link key versions;
  - consuming `alert_links.rotate_requested`;
  - honouring `v_account_status`.
- **opportunity-router, crawl-planner, billing-entitlements, marketing, hunt-manager:** read `v_account_status` and consume `account.status_changed`.
- **web-app:**
  - the Devices page at `/app/account/devices`;
  - the lease UI;
  - the picker;
  - the approval screens;
  - the notice banners;
  - `/admin/integrity`.

---

## 6. Items for legal review

One line each, with no analysis, as the owner instructed. These add detail to item 12 of `docs/legal-review.md`. The researchers' own lists are in the same folder: `security-ux-legal-review.md`, `legal-review-alerts-analogues.md` and `legal-review-oss-stack.md`. The two critiques' lists, `legal-review-friction-critic.md` and `legal-review-evasion-critic.md`, are folded in as items 27 to 45. Items 46 and 47 come from settling the conflicts between the critiques.

1. Recording IP-derived network hashes, town-level location, user agent and device labels for each session and sign-in, to detect sharing.
2. Setting a long-lived first-party recognised-device cookie at sign-in.
3. Browser fingerprinting (not in version 1; FingerprintJS v5 or ThumbmarkJS if ever adopted), including those libraries' default telemetry.
4. Per-user signed alert links that log opens, including opens by people who are not Nabvy users.
5. Invisible per-recipient variation in alert text (optional), including accessibility.
6. Internal risk scores and signals kept about users.
7. Automatic, autonomous re-verification, limits, suspensions and bans based on those signals.
8. Giving only a vague notice, never reasons, evidence, signals or scores, in any channel.
9. Answering subject access requests that cover integrity data.
10. Plan limits: device caps, one live screen, new-device allowances and Telegram re-link limits.
11. Applying these limits to subscribers who joined before the limits were introduced.
12. Terms wording: one person per account, no forwarding of alerts to groups, no resale of access, tolerance of occasional single-deal sharing.
13. Billing during a temporary suspension.
14. Cancellation with no refund on a ban for sharing.
15. Security notifications (new sign-in alerts, approval requests, "signed out" notices) sent by email, Telegram and push.
16. Showing the account holder a device list that may include another person's device and town.
17. Ban-evasion keys: hashes of email, payment-card fingerprint, device key and Telegram chat or user ID of banned accounts.
18. Storing Telegram chat and user IDs, including those of chats that reuse a link code or add the bot to a group.
19. Sending Telegram alerts with `protect_content`.
20. Push subscription endpoints tied to devices and deleted on sign-out.
21. Any manual checking of public leak groups for Nabvy alerts.
22. Processors handling this data: Vercel, Cloudflare, Supabase, Telegram, Resend.
23. Admin access to integrity data, and the audit of that access.
24. Retention periods for session events, link opens, signals, scores, actions and evasion keys.
25. A paid extra seat as the sanctioned route for sharing.
26. The software licence of `web-push` (MPL-2.0), already named in `docs/architecture.md` and `docs/secrets.md`.
27. Blocking the billing portal (card update, cancellation, trial cancellation) behind session age or a fresh sign-in, as first drafted.
28. Ban-evasion matching against accounts that existed before the ban, including household members who share a card or device.
29. Counting opens by another account holder (for example a partner) as evidence against the sender.
30. Keeping paused push endpoints for up to 30 days after an enforcement sign-out.
31. Using Apple's Private Relay egress list and inferred VPN use to discount location signals.
32. An email "Sign out everywhere" action that works without a session.
33. Logging link-preview crawler fetches of alert links (Discordbot, Slackbot, TelegramBot, facebookexternalhit, WhatsApp) and attributing them to the recipient's account.
34. Refusing an alert link to openers beyond the per-link allowance ("Sign in to see this deal").
35. Measuring alert-open timing (seconds from delivery, hour of day) to detect scripted relays.
36. Measuring how long the live screen stays visible each day, and recording the time of the last pointer, key, touch or scroll event in lease heartbeats.
37. Using hunt areas (cell level) together with the towns of alert openers as an integrity signal.
38. A hunt-set hash (products and cells of a user's hunts) kept as a ban-evasion key.
39. Normalising email addresses (removing Gmail dots and "+" tags) before hashing for ban-evasion and trial checks.
40. Refusing checkout when a payment-card fingerprint matches a banned account.
41. One free trial per card fingerprint, normalised email and device, and ending a trial at once when the check fails.
42. Reading Discord server and Telegram chat member counts for channel feeds, and an audience cap or per-member price for channel feeds.
43. Starting the enforcement ladder at the "limit" step, skipping re-verification, for relay-type evidence.
44. Scoring accounts on alert deliveries and on opens by people who are not the account holder.
45. Showing "location unknown" instead of a town on the Devices page and in the picker, and an approximate area with a caveat in security notices.
46. Comparing network hashes across two accounts to recognise a household member.
47. Keeping a foreign-opener hard rule for a ban as an owner option (D23).

---

## 7. Tests and metrics

### 7.1 Tests (fixture-first, per `CLAUDE.md`)

**Timeline fixtures** live in `fixtures/account-integrity/timelines/*.json`. Each is a sequence of session, activity, lease, approval, channel and alert-open events with town-level locations, plus the signals expected and the **highest step allowed**. The fixtures harness from task 0.6 reports a pass rate, and CI fails if it drops.

| Fixture | Expected highest step |
| --- | --- |
| One person: phone on 4G plus laptop on home broadband, same town | L0, no signals |
| One person whose mobile IP places them in London while they are in Chichester (carrier NAT) | L0 |
| A commuter: Portsmouth to London daily on train Wi-Fi | L0 |
| A traveller abroad on a VPN for 10 days | L0; watch at most |
| A sourcing trip: Chichester to Leeds and back in 2 days | L0 |
| One person on a new laptop plus a broken phone replaced in the same week | L0; approval requested at most |
| A couple sharing one Standard account from two towns 60 km apart, taking turns on the live screen | Watch (L0): contained by the one live screen, not escalated |
| One Pro account relaying alerts to a Telegram group for 21 days (15 networks within 5 minutes, daily, some opener devices belonging to other Nabvy accounts) | L3 |
| A group-buy resale over 30 days: 9 devices, 6 towns in 7 days, contested "Use here" takeovers, magic links from many networks | L4 |
| A feed scraper (steady 10-second polling, headless user agent) | Automation track, then L2 |
| A banned user signing up again with the same card and device | L4 (evasion) |
| The bot added to a group by a linked user | Leave plus `channel_misuse` signal; L0 on its own |
| **Added in the review round:** | |
| Honest user with no Telegram link hit by a false L1, signing back in on their own laptop | Signs in with one link or code; no approval asked |
| New user signs up on a laptop, opens the phone 10 minutes later and links Telegram from it | Linked; L0 |
| Laptop on a VPN exiting in Amsterdam, phone on 4G at home, daily for 14 days | L0, no signals |
| User in Truro whose 4G address places them in London, switching between wifi and 4G all day | L0 |
| One person in Newcastle: laptop on home broadband, phone on 4G whose IP places it in London (about 400 km), both used daily for 30 days | L0, no approval requests |
| An iPhone user with iCloud Private Relay set to "Use country and time zone" | L0 |
| A couple with separate Standard accounts: one sends the other 3-4 deals a week and sometimes opens alerts on the shared family iPad | L0, no signals |
| Two partners with their own paid accounts on one family laptop, each opening their own alerts there daily for 30 days | L0 |
| An iPhone user of the installed app who opens every Telegram and email alert in Safari or an in-app browser, never signed in there | L0 |
| A partner's account created a year earlier shares the joint card and the family laptop with an account banned today | L0 |
| A reseller collecting in 5 towns within 40 km in one week, twice a month | L0, no signals |
| Standard user on iPhone: signs up in Safari, installs to the home screen for push, then signs in on a laptop | L0; no picker (one phone, one slot) |
| A browser that clears cookies on exit, signed in on most days for 30 days on the home network | L0; one new-device alert at most |
| Phone lost while travelling; no Telegram link; the laptop at home was used last week; the user signs in on a new phone | Signs in through the fallback ("I can't get to my other device") |
| A reseller who sends one or two deals a week to a friend on WhatsApp | L0 |
| A reseller with the feed visible on a second monitor 08:00-20:00 every day | L0 |
| An Outlook business mailbox with link scanning; every email alert prefetched from 2-3 Microsoft networks within a minute of delivery | L0 |
| One phone on dual-stack 4G opens an alert, then the same alert is opened on home Wi-Fi and on a laptop | L0 |
| A feed streamed to Discord 07:00-01:00 daily for 14 days, with no other signal | Watch at most (L0) |
| An alert link pasted into a 20-person Discord | 3 openers, then the sign-in page; the preview fetch raises `relay_unfurl` |
| A Telegram userbot relaying a Standard account's alerts, with links and previews, to a 20-person Discord for 14 days | L3 |

**Other tests:**
- **Unit and property tests** in `src/domain`: haversine; the decay; the score rises with signal strength; band thresholds; location grades (unknown, good quality, settled); the ladder state machine (never skips a step except on hard rules and the relay-class entry at L2; own-device signals never take it past L1; pauses 24 hours between automatic escalations); lease takeover rules, including "visibly live" and silent take-back; the older device winning disputes; "Sign out everywhere" overriding it.
- **Idempotency:** every handler runs twice on the same batch and writes the same rows.
- **The "no reasons" CI test** (`docs/decisions.md`): rendered N1–N4 in app, email and Telegram, the Devices page payload, the ban message and the API error bodies contain no rule ID, signal kind, score or band.
- **Row-level security:** `v_my_devices` returns only the caller's rows, and the admin views are unreachable from `nabvy_app`.
- **Playwright:**
  - the "Use here" takeover across two browser contexts;
  - the cap picker;
  - the approval flow;
  - "Not me", with its confirmation;
  - "I can't get to my other device", both the immediate unconfirmed sign-in and the 12-hour wait;
  - "Sign out everywhere" from an email link with no session;
  - sign-in by code;
  - the alert-link opener allowance (task 4.3g);
  - the revocation taking effect on the next request.
- **grammY:**
  - group-add, then leave;
  - a private-only handler refusing a group update;
  - `protect_content` and disabled link previews set on every send;
  - a reused link code refused;
  - the same chat linked again after `/stop` not counted as a re-link.

### 7.2 Measuring and holding down false positives

- **Honest cohort.** Staff, design partners and the owner's team (lifetime Pro accounts) are treated as known single users. It also includes at least 30 volunteer Standard users recruited in the beta: iPhone users with the installed app, regular VPN users, couples with separate accounts, and users in Cornwall, Scotland, Wales and Northern Ireland; in all, at least one known single user in each UK nation and in each English region outside the South East, covering each major mobile network. Without them the cohort would be Pro accounts with a cap of 3, mostly in the South, and the gates could pass while the cases in 7.1 that matter most were never met in real traffic. Any would-be action at L1 or above on the cohort is a false positive by definition. The target is zero, and a hit automatically moves the rule back to shadow.
- **Labelled sample.** Each week, admins label a random sample of would-be and applied actions in `/admin/integrity` (up to 50 per step) as correct, wrong or unsure. Admins label from the raw timeline, with the rule ID, score, band and would-be step hidden, so that labels do not lean towards confirming the rule. "Unsure" counts as wrong for the promotion gates. Precision is reported per rule with a Wilson lower bound.
- **Promotion gates** (targets for the owner to approve, D18):
  - shadow to soft (L1 and L2 live): labelled precision of 95% or more, with a lower bound of at least 90%, on 100 or more labels, and no honest-cohort hits in 30 days;
  - soft to hard (L3 and L4 live): precision of 99% or more on 200 or more labels, and no honest-cohort hits in 30 days.
- **Demotion.** A rule whose weekly precision falls below its gate returns to shadow automatically, and the owner is alerted.
- **Backtesting.** A new rule version is replayed over the last 30 days of real events before it leaves shadow. The would-be actions are compared with the current version's.

**Friction metrics** (targets):

| Metric | Target |
| --- | --- |
| "Use here" prompts per active user per week | median 0, 95th percentile 3 or fewer |
| Approval requests per 1,000 sign-ins | 20 or fewer |
| Sign-ins that hit the device cap | 5% or fewer |
| Accounts reaching L1 per month, as a share of active accounts | 0.5% or fewer (a higher rate points to an over-sensitive rule) |
| Re-verification completion within 24 hours | tracked |
| "Contact us" messages after a notice | tracked |
| Admin lifts within 7 days of an action | tracked, as a false-positive proxy |
| Cancellations within 14 days of an action, compared with a matched control group | tracked |

**Effect metrics:**
- the weekly count of accounts with each relay-class signal (3d);
- the share of alert-link opens refused by the opener allowance;
- the share of alert opens from networks not on the account;
- **borrower conversion**: devices seen on a flagged account that later sign in to their own paid account. This is the outcome Netflix reported after its rollout: record sign-ups, and converted borrower households with "healthy retention" [S11][S12];
- the detection latency from `observed_at` to `applied_at`.

All metrics are aggregates in `v_integrity_metrics_daily`. Integrity data is never sent to PostHog.

---

## 8. Rollout

| Phase | When | What is on | How long, and the exit test |
| --- | --- | --- | --- |
| **0. Product behaviour at launch** | With the public beta, so every plan is sold with its limits from the first payment | The Devices page; new-device alerts; the device cap with picker; the live-screen lease with "Use here"; Telegram private-only, one chat, `protect_content` and link-code rules; push tied to devices; signed alert links with the opener allowance; the revocation check; the 24-hour new-session lock; sign-in codes alongside links; "Sign out everywhere" in security emails; "I can't get to my other device"; the Fair Use Policy wording (owner and lawyer) | Friction metrics within target for 2 weeks |
| **1. Shadow** | From launch, for at least 4 weeks and until each rule has 100 labels | Signals, scores and the ladder recorded with `mode = shadow`; no user impact. Exceptions that are already decided: email ban evasion blocks sign-up and card ban evasion blocks checkout (the owner's rule: "the same email or payment card"), and HTTP 429 rate limits apply | A rule moves on when it passes the promotion gate in 7.2 |
| **2. Soft** | Rule by rule, from about week 5 | L1 and L2 live for rules that passed; L3 and L4 still shadow. Approval on risk switches on | 30 days at target precision and no honest-cohort hits |
| **3. Hard** | Rule by rule, from about week 9 | L3 and L4 live for rules that passed the hard gate | Continuous: automatic demotion (7.2), a weekly metrics review in the admin dashboard |

- **Kill switch.** `ACCOUNT_INTEGRITY_MODE` can be set to `shadow` or `off` at once (an admin action, audited). Per-rule modes live in the `rules` table.
- **The existing test hunt.** The owner's team's rtx3090 hunt (Chichester) runs through phase 0 first, as the smoke test for the devices, lease and channel behaviour.

---

## 9. Owner decisions needed

Each item has a recommended default. When the owner has not yet decided, the default is used and the question goes to `docs/questions.md`.

| # | Decision | Recommended default | Why |
| --- | --- | --- | --- |
| D1 | Device model: strict single device with automatic sign-out, or a device cap plus one live screen | Cap plus one live screen with "Use here" (3a). Strict mode is available as a per-plan switch and is used by L2; L1 signs out only the devices in the evidence and keeps the longest-established one (3e) | Stops simultaneous use without inbox round trips or broken push |
| D2 | Signed-in device cap per plan | Free 2, Standard 2, Pro 3, Business 3 per seat, with an installed app and its browser counted as one device (3a). If task 4.3d cannot match them reliably on iOS, 3 on every plan | Covers phone plus laptop; bounds push fan-out |
| D3 | Whether plan limits are shown to users | Show the plan limits (device count, one live screen, one Telegram chat) on the pricing page, in the terms and on the Devices page. Keep every detection rule, threshold, signal and score internal | Hidden caps drove Disney+'s backlash [S15][S16]. Plan limits are product features, not enforcement rules |
| D4 | New-device allowance per 30 days before approval is needed | Free 3, Standard 4, Pro 5 | Tight swap limits drew complaints [S4][S22][S23] |
| D5 | A paid extra seat or "Duo" | The design supports it; its price and name are the owner's; none at launch | The paid route that big tech offers [S9][S17][S38] |
| D6 | Telegram re-links per 30 days | 2 on Free, 3 on paid plans | Stops one account being passed round a group by re-linking |
| D7 | `protect_content` on Telegram alerts | On | The cheapest stop on forwarding [S53] |
| D8 | The raw Facebook URL in alert text | Not shown; only the signed link | Otherwise forwarding bypasses detection |
| D9 | Email alerts on paid plans | Stay instant, with signed links; review after shadow data | Conservative: no change to the product promise |
| D10 | Invisible per-recipient variation | Off in version 1 | Test value on shadow data first |
| D11 | Whether L2 may move alerts to a digest | No; L2 limits channels and counts only | "Speed is ... never an artificial delay" (`docs/decisions.md`) |
| D12 | Billing during a temporary suspension | Unchanged; a ban cancels the subscription at once with no refund (existing decision) | Follows existing decisions; listed for legal review |
| D13 | Wording of N1–N4, the lease messages, the picker and its combined notice, the new-device alert, "Not me" and its confirmation, the approval screens and "I can't get to my other device", the sign-in email warning, the Telegram linked message and the alert-link "Sign in to see this deal." | The drafts in 3a, 3b, 3c and 3e | User-facing wording is the owner's (`CLAUDE.md`) |
| D14 | Push sender instead of `web-push` (MPL-2.0) | `@pushforge/builder` 2.0.5 (MIT), named in the docs by task 4.2a before task 4.2 writes any push code, so `web-push` is never installed | `CLAUDE.md` allows only MIT, Apache 2.0, BSD, ISC or PostgreSQL |
| D15 | Cloudflare proxy on `nabvy.app` | DNS-only, so Vercel's geolocation headers work [V2] | No new vendor |
| D16 | Fingerprinting | Not in version 1; FingerprintJS 5.2.0 (MIT) only if shadow data shows cookie-clearing evasion | The device cookie is enough [S63]; accuracy is limited [L6][L14] |
| D17 | Retention periods (section 5.1) | 90 days for raw activity and opens; 180 days for signals and scores; actions for the life of the account plus 12 months; evasion keys while the ban stands; trial keys (D22) for a period the owner sets, with none proposed here | Shortest periods that still support the ladder windows |
| D18 | False-positive targets and promotion gates | As in 7.2 | Protects paying users before hard steps go live |
| D19 | The ladder timings | L2 for a fixed 7 days; own-device signals go no further than L1; relay-class evidence starts at L2; L3 for 7 days, then 30; a ban after a second high within 180 days of an L3; 90 clean days step the history back | Short steps that clear themselves first (1.2) |
| D20 | A daily admin digest of automatic actions | On (information only; no approval needed) | Admins see everything without breaking the "autonomous" rule |
| D21 | Channel feeds and the public API as group routes | Before 5.3 and 5.4a ship, the owner sets an audience cap or a per-member price for channel feeds, and decides whether API keys may feed a group. Until then, a feed installs only where the member count is no more than the account's seats | At £99, Business feeds a 20-person Discord for £81 a month less than 20 Standard plans |
| D22 | Free-trial eligibility | One 7-day trial per card fingerprint, per normalised email and per device key, not only per account. When a new trial's card, email or device matches an earlier trial, the trial ends at once (Stripe `trial_end: "now"` [R18]) and the first month is charged | A fresh email and a new virtual card (a UK Revolut user can make up to 4 a month [R16]) otherwise buy a new trial each time, and a trial account is a disposable relay |
| D23 | `foreign_opener`: weight and use as a hard rule for a ban | Weight 20, not a hard rule, with the household and single-deal exclusions (3d). The option not taken: weight 35, and an L4 hard rule on `foreign_opener` from 5 or more distinct opener devices on 5 or more days in 14 | Opens by another account holder are ambiguous: a partner, or an iPhone app user's own Safari, can produce them. A permanent ban with no refund should not rest on them alone. Relays still escalate through the other relay-class signals and the relay entry at L2 (3e) |
| D24 | Location shown to users | Security alerts (new sign-in, approval request) show an approximate area with a caveat, even for a network that is not settled; the picker and the Devices page show a town only for a settled network, and "location unknown" otherwise (3a, 3b). The option not taken: a town only for settled networks everywhere | A stranger's sign-in is always on an unsettled network, so hiding the area in alerts would hide what the payer needs; the caveat and the "Not me" confirmation stop honest users signing themselves out |
| D25 | Location standard for step-up conditions 1 and 4 | "Good quality" locations (not Private Relay, not jumping 150 km within the hour), seen on 2 separate days (3b, 3d). The option not taken: settled locations only, as for score signals | Settled-only would switch these conditions off for strangers, whose networks are never settled; an approval costs one tap and the fallbacks always lead back in |

---

## 10. Backlog tasks

The IDs fit `docs/backlog.md` (letter suffixes under Phase 4). Each task works on the branch `task/<id>-<slug>` with one pull request per owning module, and is reviewed and merged by the reviewer session (`docs/decisions.md`, "Atomic modules").

**Definition of done for every task below:**
- types in `packages/contracts` (the module's file);
- tables in `packages/db` (the module's schema file and migrations, dry-run clean);
- fixture-based tests;
- `pnpm typecheck && pnpm lint && pnpm test` clean;
- a note in the module `README.md` on anything decided;
- a row in `docs/progress.md`, kept by the coordinator.

| ID | Task | Depends on | Specific definition of done |
| --- | --- | --- | --- |
| **4.2a** | Name an MIT push sender before 4.2 starts | D14 | Docs only, merged before 4.2 starts. `docs/architecture.md` Notifications row reads "web push (@pushforge/builder, Serwist)". `docs/secrets.md` VAPID row reads "Generated once with `npx @pushforge/builder vapid` (public key base64url; private key as a JWK)". `docs/backlog.md` 4.2 names `@pushforge/builder` 2.0.5 (MIT) as the push sender, depends on 4.2a, and its definition of done adds "the licence line for `@pushforge/builder` is in the pull request". Check: `web-push` appears in no `package.json` and not in `pnpm-lock.yaml` |
| **4.3c** | account-integrity foundation | 0.2, 0.3, 4.0 | Module scaffolded; `account_status`, `sessions`, `devices` and `enforcement_actions` tables; `v_account_status` and `v_session_state`; `ACCOUNT_INTEGRITY_MODE` in config; the oRPC middleware checks status and session state on every request; the N1–N4 enum; the "no reasons in user output" CI test; secrets added to `docs/secrets.md`. Test: a revoked session is refused on its next request; a suspended status expires by itself; `off` mode allows everything |
| **4.3d** | Sessions, devices and the Devices page | 4.3c, 4.3a | Device cookie; the auth hooks call the module; the session mirror plus activity buckets from Vercel headers; labels from `userAgent()`; the cap and picker, with the older device winning; "Sign out everywhere" from security emails without a session; one phone, one slot (app and browser matched by label and network hash); a cleared browser taking over its old row; the 24-hour new-session lock on devices not yet established; new-device alert email and Telegram with "Not me" and its confirmation; sign-in emails with link and code (Email OTP); `/app/account/devices` with sign-out and sign-out-others; impersonation sessions excluded. Playwright covers the picker, "Not me", "Sign out everywhere" and sign-out. Device test: a signed-out iOS home-screen app signs in with the code and receives a push |
| **4.3e** | Live-screen lease ("Use here") | 4.3c, 4.1 | `live_leases` and `lease_events`; heartbeat (with the last input time) and lapse; silent takeover when the holder is hidden, idle or lapsed, and silent take-back on the next input; "Use here" only when the holder is visibly live; feed, map and search gated, and deal cards and alerts not. Playwright runs two contexts, and the laptop never gets signed out |
| **4.3f** | Telegram binding hardening (account module) | 4.3a, D6 | Unique constraints on user and chat; single-use, 10-minute codes consumed atomically; created only from established devices (3b); re-link allowance, with the same chat linked again (for example after `/stop`) not counted; a reused code refused and logged; `channel.linked` and `channel.unlinked` events. Runbook step: BotFather group joining off |
| **4.3g** | Protected delivery and signed links (notification-dispatcher) | 1.8, 4.3c, D7, D8 | `chatType("private")` only; `leaveChat` on `my_chat_member` group adds; `protect_content: true` on every send; `link_preview_options: { is_disabled: true }` and links only in inline buttons; `/go/<token>` that never creates a session; the opener allowance and the script page; `alert_opens` plus `v_alert_open_context`; per-user key versions and rotation on `alert_links.rotate_requested`; `v_account_status` honoured. grammY tests as in 7.1. Playwright: the recipient opens a link while signed in, 3 other contexts on other networks open it, and a fifth context gets the sign-in page |
| **4.3h** | Push bound to devices (account module) | 4.2, 4.3d | Each push subscription carries `device_id` and `session_id`; subscribing needs `checkChannelBinding`; subscriptions deleted or paused on `devices.revoked`, as its `push` field says, and resumed when the device signs in again; paused subscriptions deleted after 30 days; 404 and 410 cleanup. Test: signing a device out stops its pushes; an L1 sign-out pauses them and a sign-in resumes them |
| **4.3i** | Signals and risk score (shadow) | 4.3d, 4.3e, 4.3g | The signal catalogue in 3d with versioned `rules`, including location grades and the Private Relay list refresh; the 5-minute and nightly Trigger.dev batch tasks (thin task files); decay and bands; the fixture timelines in 7.1 all pass; idempotency proven by running twice. Test: an account that only receives Telegram alerts and never opens the app is scored, and its relay signals are computed |
| **4.3j** | Enforcement ladder, notices and admin tools | 4.3i, 4.8 | L0–L4 state machine per 3e with pacing, the relay entry at L2, and own-device signals capped at L1; L1 limited to the devices in the evidence, keeping the longest-established device; L2 with a fixed end date, the kept channel and N2 shown in place of each blocked action; `enforcement_actions` and `audit_log` rows; fixed Better Auth `bannedUserMessage`; `account.status_changed`, `devices.revoked` and `alert_links.rotate_requested`; `/admin/integrity` (cases, timeline, rules, lift, override, allowlist, label), all audited; everything in `mode = shadow`. Consumers in opportunity-router, crawl-planner, billing, marketing and hunt-manager, one pull request per module |
| **4.3k** | Approval from an existing device (step-up on risk) | 4.3d, 4.3i | Spike on Better Auth's Device Authorization plugin with `user_id` pre-binding [B8], or the in-house `device_approvals` table; approval by Telegram button, push and in-app banner; 10-minute expiry; the unconfirmed fallback when no other device is active; "I can't get to my other device" (once per 30 days at once, then a 12-hour wait), also on expiry or when no approver is established; the declined message after Deny; no approval for a known device after L1, L3 or "Sign out everywhere". Playwright covers approve, deny and both fallbacks |
| **4.3l** | Rollout gates and metrics | 4.3j | Per-rule mode switching, audited; the honest-cohort list, including the volunteer Standard users (7.2); weekly label sampling from the raw timeline with rule, score, band and step hidden, and "unsure" counted as wrong; Wilson bounds; automatic demotion; `v_integrity_metrics_daily` on the admin dashboard; backtest replay over 30 days of events. Test: a rule with an honest-cohort hit drops to shadow |
| **4.3m** | Paid extra seat | 4.3, D5 | **Blocked on the owner's decision.** Better Auth Stripe seats, with the organization plugin if seat prices are used [B11]; each seat has its own login, live screen, Telegram chat and hunts |
| **4.3n** | Invisible per-recipient variation (optional) | 4.3g, D10 | Off by default; HMAC-selected equivalent layouts with no zero-width characters and no changed facts; an admin decoder; screen-reader check; variant code in `delivery_log` |
| **4.3o** | Trial eligibility (billing-entitlements) | 4.3j, D22 | `accountIntegrity.checkTrialKeys()` is called from the subscription-created hook, and a reused key ends the trial at once. Test: a second account with the same card gets no trial |

**[CHECK-IN]** after 4.3j, before any rule leaves shadow (section 8).

---

## Sources

The date is the one the page shows. "Undated" means the page shows none; the page was seen on 2026-09-24. Vendor help pages were read through search-engine extracts, because direct fetches were blocked. "Reported" means a user or press account, not company documentation.

**Streaming and media**
- [S1] Spotify Community, one device at a time and 5 offline devices (community answer, undated): https://community.spotify.com/t5/Accounts/How-many-mobile-devices-can-I-connect-with-premium/td-p/130864
- [S2] Spotify Support, "account used somewhere else" (undated): https://support.spotify.com/dk/article/account-used-somewhere-else/
- [S3] YouTube Help, Premium and streaming limits (undated): https://support.google.com/youtube/answer/7361503
- [S4] YouTube Help, Premium memberships and device limits (undated): https://support.google.com/youtube/answer/6308288
- [S5] Droid Life, YouTube enforcing family plan rules, 14-day notice (2025-09-02; reported email wording): https://www.droid-life.com/2025/09/02/youtube-enforcing-family-plan-rules/
- [S6] Netflix Help, What is a Netflix Household (undated): https://help.netflix.com/en/node/124925
- [S7] Netflix Help, How to update a Netflix Household, 15-minute link (undated): https://help.netflix.com/en/node/128339
- [S8] TechCrunch, Netflix "Manage access and devices" (2022-11-15): https://techcrunch.com/2022/11/15/netflix-new-manage-access-and-devices-feature/
- [S9] ISPreview, Netflix UK prices including Extra Member from 3 Sep 2026 (September 2026): https://www.ispreview.co.uk/index.php/2026/09/netflix-hikes-uk-prices-for-customers-of-its-video-streaming-service.html
- [S10] TechCrunch, Netflix Profile Transfer (2022-10-17): https://techcrunch.com/2022/10/17/netflix-launches-new-profile-transfer-feature-to-help-end-account-sharing
- [S11] Antenna, first look at the password-sharing crackdown (June 2023; panel estimate): https://www.antenna.live/insights/a-first-look-at-the-impact-of-netflixs-password-sharing-crackdown
- [S12] The Hollywood Reporter, cancel reaction "low" (July 2023): https://www.hollywoodreporter.com/business/business-news/netflix-password-sharing-crackdown-cancel-reaction-1235539829/
- [S13] Kantar, Netflix Spain lost over 1 million users (April 2023; panel estimate): https://www.kantar.com/inspiration/fmcg/netflix-crackdown-on-password-sharing-results-in-over-1-million-fewer-subscribers-in-spain
- [S14] Rest of World, Netflix drops fees after Latin America backlash (2022): https://restofworld.org/2022/netflix-end-password-sharing-fees-backlash-latin-america/
- [S15] Disney+ Help, What is a Disney+ Household ("there may be a limit"; no precise geolocation) (undated): https://help.disneyplus.com/article/disneyplus-account-sharing
- [S16] TechIssuesToday, Disney+ reportedly limits "away from home" to four a year (undated; reported): https://techissuestoday.com/disney-allegedly-limits-away-from-home-requests-to-four-per-year/
- [S17] Cord Busters, Disney+ Extra Member UK £4.99 (2024-09-25): https://www.cordbusters.co.uk/disney-plus-password-sharing-extra-members-pricing/
- [S18] Deadline, HBO Max staged crackdown (2025-08-07): https://deadline.com/2025/08/hbo-max-password-sharing-crackdown-warner-bros-discovery-1236481075/
- [S19] HBO Max Help, household sharing, "I'm Traveling", do not share the code (undated): https://help.hbomax.com/us/Answer/Detail/000002592
- [S20] Spotify Support, losing access to Premium Family: 7 days, move to Free, 12 months (undated): https://support.spotify.com/us/article/premium-family-verification/
- [S21] TechCrunch, Spotify ends GPS test (2018-09-28): https://techcrunch.com/2018/09/28/spotify-ends-test-that-required-family-plan-subscribers-to-share-their-gps-location/
- [S22] Prime Video Help, "Devices Limit Reached" in India (undated): https://www.primevideo.com/help?nodeId=ThlENNbZ5gxXv9QGjr
- [S23] M9 News, Prime Video device limit backfires (2025; reported): https://www.m9.news/what-to-watch-on-ott/prime-video-device-limit-backfires-on-indian-users/
- [S24] Amazon.co.uk Help, What is Amazon Family (undated): https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=GXULX24SE2RD7EXS
- [S25] Apple Support, two-factor verification codes on trusted devices (undated): https://support.apple.com/en-us/102606
- [S26] Nieman Lab, the New York Times cracking down on login sharing (2026-07-06; reported, with a company statement): https://www.niemanlab.org/2026/07/the-new-york-times-appears-to-be-cracking-down-on-login-sharing/

**SaaS and AI**
- [S27] Microsoft Support, Microsoft 365 subscription sharing: 5 devices signed in, oldest signed out (date not visible): https://support.microsoft.com/en-us/accounts-billing/subscriptions/manage-microsoft-365-subscription-sharing
- [S28] Microsoft Copilot blog, AI credits for the subscription owner only (2025-01-16): https://www.microsoft.com/en-us/copilot/blog/2025/01/16/copilot-is-now-included-in-microsoft-365-personal-and-family/
- [S29] Adobe Help, signed in on 2 devices, in use on 1 (date not visible): https://helpx.adobe.com/download-install/apps/licensing-activation/activate-deactivate-apps/install-apps-number-of-computers.html
- [S30] Adobe Help, device activation limit reached (date not visible): https://helpx.adobe.com/download-install/apps/troubleshoot/licensing-activation-issues/device-activation-limit-reached.html
- [S31] Adobe Community, "An Adobe account can be used by only one person" pop-up (thread from mid-2024 onwards; user reports): https://community.adobe.com/t5/account-payment-plan-discussions/i-keep-getting-an-adobe-account-can-be-used-by-only-one-person-and-not-shared-popup/td-p/14687354
- [S32] OpenAI Help, suspicious activity alert (date not visible): https://help.openai.com/en/articles/10471992-why-am-i-receiving-a-suspicious-activity-alert
- [S33] OpenAI Help, managing active sessions, up to 30 minutes (date not visible): https://help.openai.com/en/articles/20001257-managing-active-sessions-in-chatgpt
- [S34] OpenAI Community, Plus limited until the account is secured (early 2025; reported): https://community.openai.com/t/suspicious-activity-detected-chatgpt-plus-limited-to-gpt-4o-mini/1109597
- [S35] Figma Forum, staff reply on "a range of signals" (2026-08-04; staff-stated): https://forum.figma.com/ask-the-community-7/figma-professional-team-account-limiting-users-to-2-active-logins-need-help-56683
- [S37] LinkedIn Help, licence sharing in Recruiter and Talent Hub (date not visible): https://www.linkedin.com/help/recruiter/answer/a460987/license-sharing-in-recruiter-and-talent-hub
- [S38] LinkedIn Help, Premium Duo (date not visible): https://www.linkedin.com/help/linkedin/answer/a7145258
- [S39] LinkedIn Help, verify your identity to recover access (date not visible): https://www.linkedin.com/help/linkedin/answer/a1342692
- [S40] GitHub Community, Copilot abuse-detection warning email (2025-05-22; reported): https://github.com/orgs/community/discussions/160013
- [S41] GitHub Community, Copilot restriction email listing "credential sharing services" and "excessive or automated usage" (2025-09-22; reported): https://github.com/orgs/community/discussions/174325

**Security UX**
- [S43] Google Account Help, your devices (date not shown): https://support.google.com/accounts/answer/3067630
- [S44] Google Account Help, new sign-in alerts (date not shown): https://support.google.com/accounts/answer/2590353
- [S45] Google Account Help, "Verify it's you" for sensitive actions, 7 days (date not shown): https://support.google.com/accounts/answer/7162782
- [S46] Facebook Help, alerts about unrecognised logins (date not shown): https://www.facebook.com/help/162968940433354
- [S47] Apple Support, signing in with two-factor authentication, approximate location (date not shown): https://support.apple.com/en-us/102660
- [S48] Apple Support, associated devices and the 90-day wait (date not shown): https://support.apple.com/en-us/118412
- [S49] WhatsApp Help, linked devices (date not shown): https://faq.whatsapp.com/378279804439436
- [S50] Tom's Guide, WhatsApp Web "Use here" (date not shown; reported, not in WhatsApp's Help Centre): https://www.tomsguide.com/how-to/use-whatsapp-web-and-desktop
- [S51] Telegram official UI string, new sessions cannot terminate older sessions (date not shown): https://translations.telegram.org/en/webk/settings/RecentSessions.Error.FreshReset
- [S52] Telegram blog, sessions and 2-step verification (2015-04-08): https://telegram.org/blog/sessions-and-2-step-verification
- [S53] Telegram Bot API changelog, Bot API 5.6, `protect_content` (entry dated 2021-12-30): https://core.telegram.org/bots/api-changelog
- [S54] Telegram bug tracker, reported content-protection bypasses (date not shown; user reports): https://bugs.telegram.org/c/63404
- [S55] Telegram bot features: deep linking and `/setjoingroups` (date not shown): https://core.telegram.org/bots/features
- [S56] Microsoft Entra ID Protection risk detections (ms.date 2026-04-22): https://raw.githubusercontent.com/MicrosoftDocs/entra-docs/main/docs/id-protection/concept-identity-protection-risks.md
- [S57] Microsoft Defender for Cloud Apps, anomaly detection, impossible travel (date not shown): https://learn.microsoft.com/en-us/defender-cloud-apps/anomaly-detection-policy
- [S58] Microsoft Entra, session lifetime and MFA fatigue (ms.date 2026-04-08): https://raw.githubusercontent.com/MicrosoftDocs/entra-docs/main/docs/identity/conditional-access/concept-session-lifetime.md
- [S59] Monzo Help, one Android and one iOS device (date not shown): https://monzo.com/help/app-help/log-in-multiple-devices
- [S60] FCA PS21/19, respondents on customers lost at 90-day re-authentication (November 2021): https://www.fca.org.uk/publications/policy-statements/ps21-19-changes-sca-rts-and-guidance-approach-document-and-perimeter-guidance-manual
- [S61] NCSC, authentication methods (date not shown): https://www.ncsc.gov.uk/guidance/authentication-methods-choosing-the-right-type
- [S62] OWASP Session Management Cheat Sheet (no date; read 2026-09-24): https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Session_Management_Cheat_Sheet.md
- [S63] OWASP, device cookies (no date; read 2026-09-24): https://raw.githubusercontent.com/OWASP/www-community/master/pages/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies.md
- [S65] Device Bound Session Credentials: W3C repository (read 2026-09-24) https://github.com/w3c/webappsec-dbsc and Help Net Security (2026-04-10): https://www.helpnetsecurity.com/2026/04/10/google-chrome-device-bound-session-credentials/
- [S66] Apple, share passwords and passkeys with groups (date not shown): https://support.apple.com/guide/iphone/share-passwords-iphe6b2b7043/ios

**Paid alert products**
- [S67] TradingView Support, parallel chart connections (date not visible): https://www.tradingview.com/support/solutions/43000694474-parallel-chart-connections/
- [S68] Greasy Fork, userscript hiding TradingView's "session disconnected" pop-up (date not visible; reported behaviour): https://greasyfork.org/en/scripts/494702-tradingview-hide-disconnected-session-popup
- [S69] Bloomberg FAQ, mobile sign-in locks the Terminal session (date not visible): https://www.bloomberg.com/faq/question/device-platform-if-i-log-into-bloomberg-anywhere-on-my-mobile-device-will-it-log-me-out-from-the-terminal/
- [S70] Unusual Whales terms, auto-lock for up to 24 hours (date not visible): https://unusualwhales.com/terms
- [S71] Seller Forum, Keepa suspension "for 300 days" (date not visible; reported): https://seller-forum.com/t/my-keepa-account-was-suspended-for-300-days-bcz-i-used-it-on-two-laptops/4474 ; Trustpilot reviews (reported): https://www.trustpilot.com/review/keepa.com
- [S72] Kodai Help, unbinding and the 3-month cool-down (date not visible): https://help.kodai.io/hc/en-us/articles/360037494993-Am-I-able-to-unbind-my-license-key-from-my-Discord-account
- [S73] LaunchPass Help, changing the Discord user on a subscription (date not visible): https://help.launchpass.com/en/articles/8558608-how-do-i-change-my-discord-user-associated-with-my-subscription
- [S74] InviteMember Help, per-member join links (date not visible): http://help.invitemember.com/en/articles/2783896-telegram-integration-details
- [S75] Stratechery, "About the Feed Reset and Subscription Expired posts" (2020): https://stratechery.com/2020/about-the-feed-reset-and-subscription-expired-posts/ ; terms (date not visible): https://stratechery.com/terms-of-service/
- [S76] Mailchimp Help, unique URLs for subscribers (date not visible): https://mailchimp.com/help/create-unique-urls-for-subscribers/
- [S77] A Substack user's blog, forwarded email signed the recipient in (date not visible; reported): https://iamcantonsen.substack.com/p/a-possible-substack-security-concern
- [S78] discourse-watermarking (MIT; no release date), including its list of defeats: https://github.com/Test-Alliance-Please-Ignore/discourse-watermarking
- [S80] Pump-bot, leaked premium signal groups advertising "no delay" (2024; reported): https://pump-bot.com/premium-crypto-signals-leaked-crypto-telegram/
- [S81] CME Group, Device unit-of-count guidelines (date not visible): https://www.cmegroup.com/market-data/distributor/files/data-licensing-policy-guidelines-device-unit-us.pdf

**Better Auth** (docs read from the repository on 2026-09-24)
- [B1] Licence (MIT): https://github.com/better-auth/better-auth/blob/main/LICENSE.md ; npm `better-auth` 1.7.5, MIT: https://registry.npmjs.org/better-auth
- [B2] Session management: list and revoke, `freshAge` (1 day by default), cookie cache revocation lag: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/session-management.mdx
- [B3] Database hooks: before and after for user, session and account; abort with `false` or `APIError`: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/database.mdx
- [B5] Multi-session plugin, sessions per device (default 5): https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/multi-session.mdx ; Discussion #6134 (2025-11-20): https://github.com/better-auth/better-auth/discussions/6134
- [B6] Admin plugin: `banUser`, `banExpiresIn`, `banReason`, `bannedUserMessage` default and reason example, `impersonatedBy`: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/admin.mdx
- [B7] Magic link: `expiresIn` defaults to 300 seconds; token consumed atomically on first use: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/magic-link.mdx
- [B8] Device Authorization plugin: user codes, approve and deny, `user_id` pre-binding, Better Auth session token on success: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/device-authorization.mdx
- [B9] Rate limit: storage options; memory not suitable on serverless; IP headers: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/rate-limit.mdx
- [B10] Captcha plugin: default endpoints, explicit `endpoints`: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/captcha.mdx
- [B11] Stripe plugin: seats; `seatPriceId` needs the organization plugin: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/stripe.mdx
- [B13] Issue #11073, revoked sessions survive in a race with secondary storage only (2026-08-31, open): https://github.com/better-auth/better-auth/issues/11073
- [B14] Discussion #9988, count sessions per user rather than per device (2026-06-11): https://github.com/better-auth/better-auth/discussions/9988
- [B15] Email OTP plugin: 6-character code, 300-second expiry, 3 attempts; ships in `better-auth` (read 2026-09-24): https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/email-otp.mdx

**Platform and libraries** (versions and licences re-checked on npm, 2026-09-24)
- [V1] `@vercel/functions` header names (`x-real-ip`, `x-vercel-ip-*`) (retrieved 2026-09-24): https://raw.githubusercontent.com/vercel/vercel/main/packages/functions/src/headers.ts ; npm 3.9.9, Apache-2.0
- [V2] Vercel docs, request headers and reverse-proxy caveat (dates not visible; search extracts): https://vercel.com/docs/headers/request-headers ; https://vercel.com/docs/security/reverse-proxy
- [V3] Next.js `userAgent()` (browser, device, OS, `isBot`) (retrieved 2026-09-24): https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/03-api-reference/04-functions/userAgent.mdx
- [L1] grammY (MIT; npm 1.46.0): https://github.com/grammyjs/grammY
- [L2] grammY filter queries, `chatType`: https://raw.githubusercontent.com/grammyjs/website/main/site/docs/guide/filter-queries.md
- [L3] grammY types: `protect_content`, `leaveChat`, `my_chat_member`, `getChatMemberCount`: https://raw.githubusercontent.com/grammyjs/types/main/methods.ts ; https://raw.githubusercontent.com/grammyjs/types/main/update.ts
- [L4] `web-push` licence (MPL-2.0; npm 3.6.7): https://raw.githubusercontent.com/web-push-libs/web-push/master/LICENSE
- [L5] `@pushforge/builder` licence ("MIT License, Copyright (c) 2025 David Raphi"; npm 2.0.5, published 2026-04-23, no dependencies): https://raw.githubusercontent.com/draphy/pushforge/main/LICENSE ; README, `npx @pushforge/builder vapid` outputs keys in JWK format (read 2026-09-24): https://raw.githubusercontent.com/draphy/pushforge/main/packages/builder/README.md
- [L6] FingerprintJS: v4.6.2 BUSL-1.1 https://raw.githubusercontent.com/fingerprintjs/fingerprintjs/v4.6.2/LICENSE ; v5.2.0 MIT https://raw.githubusercontent.com/fingerprintjs/fingerprintjs/v5.2.0/LICENSE ; README (accuracy) https://github.com/fingerprintjs/fingerprintjs ; API (`monitoring`) https://raw.githubusercontent.com/fingerprintjs/fingerprintjs/master/docs/api.md
- [L7] ThumbmarkJS (MIT; npm 1.11.0; about 80% uniqueness; `logging` on by default): https://github.com/thumbmarkjs/thumbmarkjs
- [L8] `ua-parser-js` (npm 2.0.10, AGPL-3.0-or-later): https://registry.npmjs.org/ua-parser-js
- [L9] bowser (MIT; npm 2.14.1): https://raw.githubusercontent.com/bowser-js/bowser/master/LICENSE
- [L10] rate-limiter-flexible (ISC; npm 11.2.1): https://raw.githubusercontent.com/animir/node-rate-limiter-flexible/master/LICENSE.md
- [L11] tirreno (AGPL-3.0): https://raw.githubusercontent.com/tirrenotechnologies/tirreno/master/LICENSE ; Marble (Elastic License 2.0): https://raw.githubusercontent.com/checkmarble/marble/master/LICENSE ; Jube (AGPL-3.0): https://raw.githubusercontent.com/jube-home/aml-fraud-transaction-monitoring/master/LICENSE
- [L12] Keygen API (Fair Core License): https://github.com/keygen-sh/keygen-api
- [L13] MaxMind, changes to GeoLite access (30 Dec 2019): https://blog.maxmind.com/significant-changes-to-accessing-and-using-geolite-databases/
- [L14] 9to5Mac, Safari 26 counters fingerprinting (2025-07-29; reported): https://9to5mac.com/2025/07/29/with-ios-26-safari-will-counter-one-of-the-webs-most-invasive-tracking-methods/
- [L15] MDN, `PushSubscription.endpoint` is a capability URL (retrieved 2026-09-24): https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/pushsubscription/endpoint/index.md
- [L16] `json-rules-engine` (ISC; npm 7.3.1, published 2025-02-20; GitHub shows 3.1k stars and 507 forks, read 2026-09-24): https://raw.githubusercontent.com/CacheControl/json-rules-engine/master/LICENSE ; https://registry.npmjs.org/json-rules-engine ; https://github.com/CacheControl/json-rules-engine

**Group relays** (added in the review round, 2026-09-24)
- [T1] Telegram FAQ, "You can log in to Telegram from as many of your devices as you like — all at the same time" (undated; search extract, direct fetch blocked): https://telegram.org/faq
- [T2] TDLib API schema: a message's `content` is delivered with `can_be_saved`, so protection is a flag the client honours (master, retrieved 2026-09-24): https://github.com/tdlib/td/blob/master/td/generate/scheme/td_api.tl
- [T3] AOSP `NotificationListenerService`, "receives calls from the system when new notifications are posted or removed" (retrieved 2026-09-24): https://github.com/aosp-mirror/platform_frameworks_base/blob/main/core/java/android/service/notification/NotificationListenerService.java
- [T4] Discord Support, Go Live and Screen Share, up to 50 concurrent viewers (date not visible; search extract): https://support.discord.com/hc/en-us/articles/360040816151-Go-Live-and-Screen-Share
- [T5] Discord API docs pull request #8606, `Discordbot/2.0` fetcher user agent (opened 2026-09-16; open, not merged): https://github.com/discord/discord-api-docs/pull/8606
- [T6] Slack Robots, `Slackbot-LinkExpanding 1.0` (undated; search extract): https://api.slack.com/robots

**Honest-user friction and evasion** (added in the review round, 2026-09-24)
- [R1] Outline issue #3192, no way to have the PWA open the magic link received by email (opened 2022-03-03): https://github.com/outline/outline/issues/3192
- [R2] WebKit bug 181849, "Add to homescreen" apps don't share storage with Safari (filed 2018; page blocked, read through a search extract on 2026-09-24): https://bugs.webkit.org/show_bug.cgi?id=181849
- [R3] WebKit, tracking prevention: "The website data of home screen web applications is kept isolated from Safari" (undated; search extract on 2026-09-24, direct fetch blocked): https://webkit.org/tracking-prevention/
- [R4] Apple Developer, `SFSafariViewController`: an app cannot access Safari's website data through it (retrieved 2026-09-24): https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller
- [R5] MaxMind, IP geolocation accuracy: a mobile IP "may move between users who are hundreds of kilometers away from each other over the course of even a few minutes" (undated; search extract, 2026-09-24): https://www.maxmind.com/en/geoip/ip-geolocation-accuracy
- [R6] Apple Developer, prepare your network for iCloud Private Relay: adjust IP-based fraud detection; "Consider treating these addresses like larger carrier-grade NAT" (undated; read 2026-09-24): https://developer.apple.com/icloud/prepare-your-network-for-icloud-private-relay/
- [R7] Apple Support, iCloud Private Relay, "Use country and time zone" (undated; search extract): https://support.apple.com/en-us/102602
- [R8] Apple, iCloud Private Relay egress IP ranges (data file named in [R6]): https://mask-api.icloud.com/egress-ip-ranges.csv
- [R9] "Lost in the Prefix", arXiv 2605.21937: mobile median errors of 179–207 km against 3–16 km on fixed networks (May 2026; search extract): https://arxiv.org/abs/2605.21937
- [R10] MDN, `Document.visibilityState`: "visible" means the foreground tab of a non-minimised window (no date; read 2026-09-24): https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/document/visibilitystate/index.md
- [R11] Telegram API, content protection: forwards, downloads, copying and screenshots must be disabled for `noforwards` messages (undated; search extract, 2026-09-24): https://core.telegram.org/api/content-protection
- [R12] Microsoft Defender for Office 365, Safe Links: URLs scanned before delivery (date not visible; search extract, direct fetch blocked): https://learn.microsoft.com/en-us/defender-office-365/safe-links-about
- [R13] Campaign Cleaner, email bot opens and clicks (2026; reported): https://campaigncleaner.com/blog/email-bot-opens-clicks.html
- [R14] Dark Visitors, TelegramBot and other preview agents (undated; reported, not company documentation): https://darkvisitors.com/agents/telegrambot
- [R15] Gmail Help, dots and "+" aliases deliver to the same inbox (undated; search extract): https://support.google.com/mail/answer/7436150
- [R16] Revolut Help, multiple cards: up to 4 new virtual cards a month in the UK (undated; search extract): https://help.revolut.com/help/cards/card-order/can-i-have-multiple-cards/
- [R17] Stripe API, card object, `fingerprint` (undated; search extract): https://docs.stripe.com/api/cards/object
- [R18] Stripe, subscription trials, ending a trial early with `trial_end` set to now (undated; search extract): https://docs.stripe.com/billing/subscriptions/trials
- [R19] Discord API docs, guild resource, `approximate_member_count` with `with_counts=true` (retrieved 2026-09-24): https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild.mdx
- [R20] grammY types, `LinkPreviewOptions.is_disabled` (retrieved 2026-09-24): https://raw.githubusercontent.com/grammyjs/types/main/message.ts
