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

test('the restricted notice shows only the vague message', async ({ page }) => {
  await page.goto('/errors/restricted')
  const text = await page.locator('main').innerText()
  expect(text).toContain('Your account has been restricted under our terms.')
  expect(text).not.toMatch(/\b(ban|banned|suspend|suspended|until|reason)\b/i)
})
