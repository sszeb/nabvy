import { expect, test } from '@playwright/test'
import { errorKinds, errorPages } from '../src/lib/errors'

/** Every error page in the four projects, plus the real 404 for an unknown address. */

const shotDir = '../../docs/design/screens'
const forbidden = [/!/, /\b(worth|fair value|hurry|last chance|act now)\b/i]

for (const kind of errorKinds) {
  test(`error ${kind} renders and follows the copy rules`, async ({ page }, info) => {
    const response = await page.goto(`/errors/${kind}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(errorPages[kind].title)
    const text = await page.locator('body').innerText()
    for (const pattern of forbidden) expect(text).not.toMatch(pattern)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await page.screenshot({
      path: `${shotDir}/error-${kind}-${info.project.name}.png`,
      animations: 'disabled',
    })
  })
}

test('an unknown address answers 404 with the error page', async ({ page }) => {
  const response = await page.goto('/no-such-page')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(errorPages['404'].title)
  await expect(page.getByRole('link', { name: 'Go to your dashboard' })).toBeVisible()
})

test('the restricted notice names the step and policy only, and offers a review', async ({
  page,
}) => {
  await page.goto('/errors/restricted?step=suspended&policy=fair-use&reason=chargeback-abuse')
  const text = await page.locator('main').innerText()
  expect(text).toContain('Your account has been suspended under our Fair Use Policy.')
  expect(text).toContain('You can ask for a review within 30 days.')
  expect(text).not.toMatch(/chargeback|abuse|until|reason/i)
  await expect(page.getByRole('link', { name: 'Ask for a review' })).toBeVisible()
})
