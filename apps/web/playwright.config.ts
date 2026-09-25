import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { gateServerEnv } from './e2e/admin-gate.env'

/**
 * Screen tests: every key screen in light and dark, at desktop and mobile widths, plus keyboard
 * and copy checks. Runs against a production build (`pnpm build` first). Screenshots are written
 * to docs/design/screens/ for review; they are records, not pixel baselines, because fonts
 * differ between machines.
 *
 * Uses the machine's preinstalled Chromium when there is one (cloud sessions); never downloads.
 *
 * The `gate` project is the admin gate over plain HTTP (e2e/admin-gate.spec.ts): no browser, and
 * the server gets the auth configuration from e2e/admin-gate.env.ts. CI runs it in the migration
 * dry-run job, against the migrated database.
 */
const preinstalled = '/opt/pw-browsers/chromium'
const launchOptions = existsSync(preinstalled) ? { executablePath: preinstalled } : {}

const gateSpec = /admin-gate\.spec\.ts$/

const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
const mobile = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['iPhone 13'].userAgent,
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    launchOptions,
  },
  projects: [
    { name: 'desktop-light', testIgnore: gateSpec, use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', testIgnore: gateSpec, use: { ...desktop, colorScheme: 'dark' } },
    { name: 'mobile-light', testIgnore: gateSpec, use: { ...mobile, colorScheme: 'light' } },
    { name: 'mobile-dark', testIgnore: gateSpec, use: { ...mobile, colorScheme: 'dark' } },
    { name: 'gate', testMatch: gateSpec },
  ],
  webServer: {
    command: 'pnpm exec next start --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    env: gateServerEnv,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
