import { expect, test } from '@playwright/test'

test.describe('keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard checks run at desktop width')

  test('skip link is the first stop and moves focus to the main content', async ({ page }) => {
    await page.goto('/app')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#main$/)
  })

  test('the command palette opens with Ctrl+K and opens a deal by keyboard', async ({ page }) => {
    await page.goto('/app')
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog')
    await expect(palette).toBeVisible()
    await page.keyboard.type('3070 gaming x')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/app\/deal\/d-1001$/)
    await expect(palette).toBeHidden()
  })

  test('Escape closes the command palette', async ({ page }) => {
    await page.goto('/app/deals')
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('the evidence popover opens from the keyboard', async ({ page }) => {
    await page.goto('/app/deal/d-1002')
    const trigger = page.getByRole('button', { name: 'See the evidence' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Why this label')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Why this label')).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('the home search submits to the deal feed', async ({ page }) => {
    await page.goto('/app')
    await page.getByRole('searchbox', { name: 'Search deals near you' }).fill('rtx 3070')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/app\/deals\?q=rtx\+3070/)
    // The card itself and the gaming PC with the same GPU.
    await expect(page.getByTestId('deal-card')).toHaveCount(2)
  })
})

test.describe('mobile shell', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only')

  test('bottom bar and menu sheet navigate', async ({ page }) => {
    await page.goto('/app')
    const quick = page.getByRole('navigation', { name: 'Quick' })
    await expect(quick).toBeVisible()
    await quick.getByRole('link', { name: 'Hunts' }).click()
    await expect(page).toHaveURL(/\/app\/hunts$/)
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Preferences' }).click()
    await expect(page).toHaveURL(/\/app\/account\/preferences$/)
    await expect(page.getByRole('dialog')).toBeHidden()
  })
})

test.describe('rules on screen', () => {
  test('a position is hidden below ten comparable asks', async ({ page }) => {
    await page.goto('/app/deal/d-1003')
    const position = page.getByTestId('price-position')
    await expect(position).toHaveAttribute('data-state', 'hidden')
    await expect(position).toContainText('Not enough comparable asks')
  })

  test('suspected labels start with "Suspected" and offer a report route', async ({ page }) => {
    await page.goto('/app/deal/d-1004')
    const label = page.getByTestId('suspected-label')
    await expect(label).toContainText(/^Suspected copied advert: /)
    await expect(label.getByRole('button', { name: 'Report a mistake' })).toBeVisible()
  })

  test('valuations carry "Estimates, not advice"', async ({ page }) => {
    await page.goto('/app/deal/d-1001')
    await expect(page.getByText('Estimates, not advice')).toBeVisible()
  })

  test('the manifest is served', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest')
    expect(response.ok()).toBe(true)
    const manifest = await response.json()
    expect(manifest.name).toBe('Nabvy')
    expect(manifest.icons.length).toBeGreaterThan(0)
  })
})
