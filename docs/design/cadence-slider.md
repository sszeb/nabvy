<!-- Coordinator 5, 2026-09-24 17:20: from a two-designer panel (Claude-faithful and hunt-native angles) with a critic; the critic chose the first and grafted the inline lock hint from the second. Wording shown to users (the mode names, captions) is provisional until the owner approves it; see docs/questions.md. -->

# Cadence Slider — final spec

**One-screen summary.** A single control in the want editor replaces the interval dropdown: a vertical, six-step, square-dot density slider modelled on Claude Code's Effort control, with **1 min at the top (Ultracheck) and 4 h at the bottom (Slow Watch)**. Label row shows the current mode name in the accent colour; a caption reads `Fastest ⟶ Slowest`. Dot count and accent intensity climb toward the top step. Steps above the plan's cadence ceiling stay visible, dim, and keyboard-reachable, with an inline (non-modal) "Requires Pro" hint — never hidden, never silently blocked. Below the track, two calm, muted-text lines report the estimated monthly credit cost and, only when it differs, the area's currently *delivered* cadence — both sourced from the estimate procedure, never computed or invented client-side. Free accounts see the same track in a read-only burst timeline. One accent colour throughout, low-contrast surfaces, no red/alarm colour anywhere on this control, motion limited to a single ~150 ms transition that collapses to 0 ms under `prefers-reduced-motion`.

## Concept
A six-notch vertical dot-density slider — modelled directly on Claude Code's Effort control — lets a user pick how fast a want is checked, from **Slow Watch** (4 h) at the bottom to **Ultracheck** (1 min) at the top. Density and accent intensity climb with speed. Locked steps above the plan ceiling stay visible but dim, with an inline upgrade hint. A caption line under the track always shows the credit estimate and, when it differs, the area's currently delivered cadence — so the trade-off between speed, cost and what's actually funded right now is never hidden, and no number is ever invented.

## Anatomy and states
1. **Label row** — `Cadence` (text-sm, muted-foreground) + current mode name (`text-primary font-medium`, e.g. `Ultracheck`) + `?` help icon opening a small popover ("chosen vs. delivered, explained").
2. **Caption row** — `Fastest` (top) / `Slowest` (bottom), text-xs muted-foreground.
3. **Track** — 6 stacked dot-rows, top→bottom fastest→slowest. Each row is a cluster of small square dots (`rounded-[2px]`); dot count rises 6→1 from top to bottom. States:
   - *Available, unselected*: `bg-muted-foreground/40`.
   - *Selected step and faster steps up to it*: `bg-primary` (opacity ramps toward full at the chosen step, not a hard fill line — mirrors the Claude reference).
   - *Locked (above plan ceiling)*: `bg-muted-foreground/20`, row label at `text-muted-foreground/60`, small lock glyph (reuses `text-muted-foreground`, never a warning colour).
4. **Thumb** — round, `bg-background border-2 border-primary`, rests on the row for the current step; `focus-visible:ring-2 ring-ring ring-offset-2` (keyboard only, no ring on pointer interaction).
5. **Locked-row interaction** — row is focusable and selectable; on focus/hover/tap it shows an inline, non-modal hint next to the row ("Requires Pro"), not a sheet or dialog. Committing a locked step does not save; it opens the plan's upgrade detail.
6. **Estimate line** — `~{n} credits / mo` (from the estimate procedure only).
7. **Live-cadence line** — appears only when the area currently delivers slower than the chosen step: `delivered every {area cadence} here`. Framed as a fact, never an error or warning.
8. **Unlock nudge** (optional third line, quieter) — `{n} more watchers unlock {cadence} here` — shown only when the next step is reachable via area unlock rather than plan upgrade.
9. **Pin action** (only when relevant) — small text-button under the notes: `Pin this pace — from £X/mo`, opens pricing detail; never auto-applied.

## Step ladder and labels
| Position (top→bottom) | Interval | Mode name |
|---|---|---|
| 1 (top, fastest) | 1 min | **Ultracheck** |
| 2 | 5 min | **Rapid** |
| 3 | 15 min | **Brisk** |
| 4 | 1 h | **Regular** |
| 5 | 2 h | **Steady** |
| 6 (bottom, slowest) | 4 h | **Slow Watch** |

Names are Nabvy's own words (no borrowed branding), one word each, chosen for a calm deal-hunting register rather than urgency/alarm language.

## Plan limit and locked steps
The ceiling is a policy value read at run time (provisionally: Starter → Regular, Pro → Rapid, Max → Ultracheck). Steps above the ceiling render in the locked visual state (§Anatomy 3–5) but remain visible, present in tab/arrow-key order, and describable to assistive tech — satisfying "never hidden." Selecting a locked step never saves silently; it surfaces the inline hint and, on commit, the plan's upgrade detail names the plan that unlocks it.

## Cost and live-cadence notes
Both lines are server-derived from the estimate procedure and re-fetched (debounced) as the user drags or steps the slider — never computed in the client. The cost line always shows; the live-cadence line shows only when delivered cadence < chosen cadence, worded as a structural fact ("delivered where the area funds it"), not a dismissible toast and not styled as a warning.

## Burst mode (free accounts)
Same track, read-only — no thumb drag. A filled timeline overlay shows the four burst phases as contiguous segments: Ultracheck (20 min) → Rapid (100 min) → Brisk (2 h) → Regular (thereafter), with a static marker (no looping animation) at elapsed position. Label row reads `Free burst` instead of a mode name; caption reads `used {n} of 3 this week · resets in {h}h`. No interaction is possible; a single link, `Upgrade to choose your pace`, replaces the estimate/unlock lines. Exposed to assistive tech as `role="img"` with a full text summary of the four segments and current position (not slider semantics).

## Motion
Default: thumb position and dot-opacity ramp transition once over ~150 ms ease-out on drag or keyboard step; the row highlight climbs with a soft ~80 ms stagger per row, playing once per change — never looping, never flashing, no glow or shake effects.
`prefers-reduced-motion`: all transitions become instant (0 ms); no stagger; dots and thumb snap directly to the new state. The burst-mode position marker is static in both modes (it never pulses).

## Colour and type (shadcn tokens)
- Track base / available dot: `bg-muted-foreground/40`
- Selected/active dot: `bg-primary`
- Locked dot: `bg-muted-foreground/20`; locked row text: `text-muted-foreground/60`
- Thumb: `bg-background`, `border-primary`
- Mode name: `text-primary font-medium text-sm`
- Caption / estimate / live-cadence / unlock lines: `text-muted-foreground text-xs`
- **One accent only** (`primary`); no secondary hue; no saturated warning colour anywhere on this control, including the "credits run out" and "delivered slower" notes — both stay in muted text with a link, consistent with "don't tire the eyes." The lock glyph reuses `text-muted-foreground`, never red.
- Both themes: dot ramp and accent must hold WCAG AA contrast against `bg-card`; no pure white/black.
- Font: inherit the app's sans stack; no new typeface.

## Keyboard and screen reader
- Built on radix `Slider` (`orientation="vertical"`), `role="slider"`, `aria-valuemin/max/now` mapped to step index, `aria-valuetext` set to mode name + interval (e.g. `"Rapid, checks every 5 minutes"`), never the raw index.
- Arrow Up = faster step, Arrow Down = slower step; Home = slowest available position, End = fastest position — **locked steps remain in the traversal order** (not skipped), so keyboard users can always reach and hear them.
- A focused locked step is announced via `aria-describedby` pointing to a visually-hidden node: `"Requires Pro plan"`.
- Estimate and live-cadence lines sit in an `aria-live="polite"` region that announces only when their value changes as a result of user interaction, not on every render, to avoid chatter.
- Focus-visible ring shown for keyboard focus only; no ring on pointer interaction (standard shadcn pattern).

## Mobile
Below ~480 px, the same vertical track runs full-bleed within the 16 px gutters. Each row's hit area is padded to at least 44×44 px (dots stay visually small; padding, not dot size, expands the touch target). Estimate/live-cadence/unlock text wraps to at most two lines, never truncated silently. No horizontal scroll is introduced.

## Edge cases
- **Area currently slower than chosen pace**: the live-cadence line always states the gap (`delivered every {area cadence} here`) whenever it differs from the chosen step; never rendered as an error, and the pin action is offered alongside it.
- **Credits will run out mid-month**: a second muted-text line appears under the estimate — `At this pace, credits run out around {date}` — same neutral styling as the rest of the control (no red/alarm colour), with a link to top up or lower the pace. Date/figure always from the estimate procedure.
- **Plan downgrade**: any want whose stored cadence is now above the new ceiling auto-locks visually on next load (does not silently change the interval). A one-time banner lists the affected wants and lets the user pick a new pace per want; the stored interval is left untouched until the user re-saves that want, so a later re-upgrade restores the original choice with no data loss.

## Open questions for the owner (product wording only)
1. Confirm the six mode names (Slow Watch, Steady, Regular, Brisk, Rapid, Ultracheck) are the ones to ship, or whether marketing prefers different wording.
2. Confirm the exact copy for the help-icon popover explaining "chosen vs. delivered" cadence.
3. Confirm whether the pin-price CTA copy is `Pin this pace — from £X/mo` or a different phrase.
