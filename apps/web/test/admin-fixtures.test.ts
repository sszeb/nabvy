import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdminOverview, listReviewQueue } from '@/data'

/**
 * Admin fixtures never reach a production build (docs/design/admin-hardening.md, H13 and A11).
 * `next build` and `next start` set NODE_ENV to `production`, so a deployed admin page refuses
 * until task 4.1 replaces the fixtures with the audited procedures.
 */
describe('admin fixtures in production', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('refuses both admin reads under production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(getAdminOverview()).rejects.toThrow(/not served in production/)
    await expect(listReviewQueue()).rejects.toThrow(/not served in production/)
  })

  it('serves them in development and test', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await expect(getAdminOverview()).resolves.toHaveProperty('providerEnabled')
    vi.stubEnv('NODE_ENV', 'test')
    await expect(listReviewQueue()).resolves.toBeInstanceOf(Array)
  })
})
