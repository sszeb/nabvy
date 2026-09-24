import { expect, test } from '@playwright/test'

/** The key screens. Each is captured in all four projects (light and dark, desktop and mobile). */
const screens = [
  { name: 'landing', path: '/' },
  { name: 'waitlist', path: '/waitlist' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'pricing', path: '/pricing' },
  { name: 'onboarding', path: '/app/onboarding' },
  { name: 'dashboard', path: '/app' },
  { name: 'deals', path: '/app/deals' },
  { name: 'deal', path: '/app/deal/d-1002' },
  { name: 'hunts', path: '/app/hunts' },
  { name: 'hunt-edit', path: '/app/hunts/h-1' },
  { name: 'alerts', path: '/app/alerts' },
  { name: 'account', path: '/app/account' },
  { name: 'preferences', path: '/app/account/preferences' },
  { name: 'scan', path: '/app/scan' },
  { name: 'admin', path: '/admin' },
  { name: 'review', path: '/admin/review' },
  { name: 'design', path: '/design' },
]

const shotDir = '../../docs/design/screens'

/** Copy rules checked on the rendered text of every screen (docs/web-app.md, Precedence table). */
const forbidden = [
  /!/,
  /\b(worth|fair value|relisted|seen before|hurry|last chance|act now)\b/i,
  /\b(ebay|cex|gumtree|vinted)\b/i,
  /\b(deal|risk|scam) score\b/i,
]

for (const screen of screens) {
  test(`${screen.name} renders and follows the copy rules`, async ({ page }, info) => {
    const response = await page.goto(screen.path)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1').first()).toBeVisible()

    const text = await page.locator('body').innerText()
    for (const pattern of forbidden) expect(text).not.toMatch(pattern)

    // Listing photos are off: no image element is ever rendered.
    await expect(page.locator('main img')).toHaveCount(0)

    // No horizontal scroll at any width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    await page.screenshot({
      path: `${shotDir}/${screen.name}-${info.project.name}.png`,
      fullPage: screen.name === 'design' && info.project.name.startsWith('desktop'),
      animations: 'disabled',
    })
  })
}

test('command palette, open', async ({ page, isMobile }, info) => {
  test.skip(isMobile, 'captured at desktop width')
  await page.goto('/app')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: `${shotDir}/command-palette-${info.project.name}.png` })
})
