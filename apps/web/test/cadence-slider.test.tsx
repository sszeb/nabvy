import type { WantManagerCadenceEstimate } from '@nabvy/contracts/modules/want-manager'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CadenceSlider } from '../src/components/cadence-slider'
import { CADENCE_STEPS } from '../src/lib/cadence'

/**
 * Fixture render tests for the cadence slider (docs/design/cadence-slider.md): no jsdom in this
 * project, so each state is rendered with `renderToStaticMarkup` and checked as HTML, the same
 * way the design's "no invented numbers" rule is checked — only strings that came from the
 * `estimate`/`burst` props may appear.
 */

const baseEstimate: WantManagerCadenceEstimate = {
  chosenCadenceSeconds: 3600,
  planCeilingSeconds: 60,
  creditsPerMonth: 18,
  deliveredCadenceSeconds: null,
  unlockWatchersNeeded: null,
  unlockCadenceSeconds: null,
  creditsRunOutDate: null,
}

describe('CadenceSlider, interactive', () => {
  it.each(CADENCE_STEPS)('renders the $name step, unlocked', ({ seconds, name }) => {
    const html = renderToStaticMarkup(
      <CadenceSlider
        value={seconds}
        estimate={{ ...baseEstimate, chosenCadenceSeconds: seconds }}
        onValueChange={() => {}}
      />,
    )
    expect(html).toContain('data-state="interactive"')
    expect(html).toContain(name)
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="5"')
    expect(html).not.toContain('Requires Pro')
  })

  it('renders a locked step with the inline hint, never hidden', () => {
    const html = renderToStaticMarkup(
      <CadenceSlider
        value={300}
        estimate={{ ...baseEstimate, chosenCadenceSeconds: 300, planCeilingSeconds: 3600 }}
        onValueChange={() => {}}
      />,
    )
    expect(html).toContain('Rapid')
    expect(html).toContain('Requires Pro')
    expect(html).toContain('Requires Pro plan')
    expect(html).toContain('aria-describedby')
    // Every step stays in the traversal order: locked rows are dimmed, never removed.
    for (const step of CADENCE_STEPS) {
      expect(html).toContain(step.name)
    }
  })

  it('renders every estimate line, and only from the estimate prop', () => {
    const estimate: WantManagerCadenceEstimate = {
      chosenCadenceSeconds: 3600,
      planCeilingSeconds: 900,
      creditsPerMonth: 27,
      deliveredCadenceSeconds: 7200,
      unlockWatchersNeeded: 6,
      unlockCadenceSeconds: 3600,
      creditsRunOutDate: '2026-10-18T00:00:00.000Z',
    }
    const html = renderToStaticMarkup(
      <CadenceSlider value={3600} estimate={estimate} onValueChange={() => {}} />,
    )
    expect(html).toContain('~27 credits / mo')
    expect(html).toContain('delivered every 2 hours here')
    expect(html).toContain('6 more watchers unlock 1 hour here')
    expect(html).toContain('At this pace, credits run out around 18 Oct')
  })

  it('omits the delivered, unlock and run-out lines when the estimate has none', () => {
    const html = renderToStaticMarkup(
      <CadenceSlider value={3600} estimate={baseEstimate} onValueChange={() => {}} />,
    )
    expect(html).toContain('~18 credits / mo')
    expect(html).not.toContain('delivered every')
    expect(html).not.toContain('unlock')
    expect(html).not.toContain('credits run out')
  })
})

describe('CadenceSlider, burst mode', () => {
  it('renders a read-only role=img timeline with no thumb, no invented numbers', () => {
    const html = renderToStaticMarkup(
      <CadenceSlider
        mode="burst"
        burst={{ usedThisWeek: 1, weeklyLimit: 3, resetsInHours: 52, elapsedMinutes: 35 }}
      />,
    )
    expect(html).toContain('data-state="burst"')
    expect(html).toContain('Free burst')
    expect(html).toContain('role="img"')
    expect(html).toContain('used 1 of 3 this week')
    expect(html).toContain('resets in 52h')
    expect(html).toContain('Upgrade to choose your pace')
    expect(html).not.toContain('role="slider"')
  })
})
