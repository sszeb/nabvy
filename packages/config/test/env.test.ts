import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EnvError, type EnvGroup, envGroups, envVariableNames, loadEnv, safeLoadEnv } from '../src'
import fixture from './fixtures/complete-env.json'

const complete: Readonly<Record<string, string>> = fixture.env
const allGroups = Object.keys(envGroups) as EnvGroup[]
const readRepoFile = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

const without = (...names: string[]) =>
  Object.fromEntries(Object.entries(complete).filter(([name]) => !names.includes(name)))

const failure = (run: () => unknown): EnvError => {
  try {
    run()
  } catch (error) {
    if (error instanceof EnvError) return error
    throw error
  }
  throw new Error('expected loadEnv to throw')
}

describe('loadEnv', () => {
  it('accepts the complete fixture for every group', () => {
    const env = loadEnv(allGroups, complete)
    expect(env.DATABASE_URL).toBe(complete.DATABASE_URL)
    expect(env.EBAY_ENV).toBe('sandbox')
    expect(env.USD_GBP_RATE).toBe(0.79)
    expect(env.CEX_DAILY_CAP_CALLS).toBe(300)
    expect(env.ADMIN_EMAILS).toEqual(['founder@example.com', 'second@example.com'])
  })

  it('fails fast and names every missing variable of the requested groups', () => {
    const error = failure(() =>
      loadEnv(['database', 'apify'], without('DATABASE_URL', 'APIFY_TOKEN')),
    )
    expect(error.missing).toEqual(['DATABASE_URL', 'APIFY_TOKEN'])
    expect(error.message).toContain('missing DATABASE_URL, APIFY_TOKEN')
  })

  it('treats empty and blank values as missing, as in a copied .env.example', () => {
    const error = failure(() =>
      loadEnv(['telegram', 'database'], {
        ...complete,
        TELEGRAM_BOT_TOKEN: '',
        DATABASE_URL: '   ',
      }),
    )
    expect(error.missing).toEqual(['TELEGRAM_BOT_TOKEN', 'DATABASE_URL'])
  })

  it('ignores variables outside the requested groups', () => {
    const env = loadEnv(['database'], without('STRIPE_SECRET_KEY', 'APIFY_TOKEN'))
    expect(env).toEqual({ DATABASE_URL: complete.DATABASE_URL })
  })

  it('gives defaults only to the variables whose value docs/secrets.md states', () => {
    // Against an empty environment every variable is missing except exactly these.
    const defaults = {
      FB_DAILY_CAP_MINOR: 1000,
      GUMTREE_DAILY_CAP_MINOR: 500,
      SCAN_SPEND_CAP_MINOR: 5,
      EBAY_INSIGHTS_ENABLED: false,
      CEX_API_BASE: 'https://wss2.cex.uk.webuy.io/v3',
      CEX_DAILY_CAP_CALLS: 300,
      MODEL_DEFAULT: 'claude-haiku-4-5-20251001',
      MODEL_ESCALATION: 'claude-sonnet-5',
      MODEL_VISION: 'claude-sonnet-5',
      POSTCODES_IO_BASE: 'https://api.postcodes.io',
      POSTHOG_HOST: 'https://eu.i.posthog.com',
      LANGFUSE_SAMPLE_RATE: 1,
      LIVE_PROVIDERS: false,
      NODE_ENV: 'development',
    }
    const error = failure(() => loadEnv(allGroups, {}))
    expect(error.missing).toEqual(envVariableNames.filter((name) => !(name in defaults)))

    const groups = [
      'spendCaps',
      'ebay',
      'cex',
      'models',
      'postcodes',
      'posthog',
      'langfuse',
      'testing',
      'runtime',
    ] as const
    const secrets = without(...Object.keys(defaults))
    expect(loadEnv(groups, secrets)).toMatchObject(defaults)
  })

  it('accepts local http URLs for the app and Supabase, but not a missing scheme', () => {
    const local = {
      ...complete,
      SUPABASE_URL: 'http://127.0.0.1:54321',
      BETTER_AUTH_URL: 'http://localhost:3000',
    }
    expect(loadEnv(['storage', 'auth'], local).SUPABASE_URL).toBe('http://127.0.0.1:54321')

    const error = failure(() =>
      loadEnv(['storage', 'auth', 'cex'], {
        ...complete,
        SUPABASE_URL: 'ftp://example.com',
        BETTER_AUTH_URL: 'localhost:3000',
        CEX_API_BASE: 'http://wss2.cex.uk.webuy.io/v3',
      }),
    )
    expect(error.invalid).toEqual(['SUPABASE_URL', 'BETTER_AUTH_URL', 'CEX_API_BASE'])
    expect(error.message).toContain('CEX_API_BASE (must be an https:// URL)')
  })

  it('keeps later-phase eBay variables out of the Browse group', () => {
    const browse = without('EBAY_RUNAME', 'EBAY_EPN_CAMPAIGN_ID')
    expect(loadEnv(['ebay'], browse).EBAY_ENV).toBe('sandbox')
    expect(failure(() => loadEnv(['ebaySell', 'ebayPartnerNetwork'], browse)).missing).toEqual([
      'EBAY_RUNAME',
      'EBAY_EPN_CAMPAIGN_ID',
    ])
  })

  it('reports malformed values as invalid without echoing them', () => {
    const secretLookingValue = 'mysql://nabvy_app:hunter2@db.example.com/postgres'
    const error = failure(() =>
      loadEnv(['database', 'ebay', 'exchangeRate'], {
        ...complete,
        DATABASE_URL: secretLookingValue,
        EBAY_ENV: 'staging',
        USD_GBP_RATE: '-1',
      }),
    )
    expect(error.missing).toEqual([])
    expect(error.invalid).toEqual(['DATABASE_URL', 'EBAY_ENV', 'USD_GBP_RATE'])
    expect(error.message).not.toContain('hunter2')
    expect(error.message).not.toContain('staging')
  })

  it('parses boolean flags strictly', () => {
    expect(loadEnv(['testing'], { LIVE_PROVIDERS: 'true' }).LIVE_PROVIDERS).toBe(true)
    expect(failure(() => loadEnv(['testing'], { LIVE_PROVIDERS: 'yes please' })).invalid).toEqual([
      'LIVE_PROVIDERS',
    ])
  })

  it('rejects a malformed admin address list', () => {
    const error = failure(() => loadEnv(['auth'], { ...complete, ADMIN_EMAILS: 'founder, ,' }))
    expect(error.invalid).toEqual(['ADMIN_EMAILS'])
  })
})

describe('variable inventory', () => {
  it('declares each variable in exactly one group', () => {
    expect(new Set(envVariableNames).size).toBe(envVariableNames.length)
  })

  it('matches the variables listed in docs/secrets.md', () => {
    const documented = readRepoFile('docs/secrets.md')
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .flatMap((line) => {
        const firstCell = line.split('|')[1] ?? ''
        return [...firstCell.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1])
      })
    expect([...envVariableNames].sort()).toEqual([...new Set(documented)].sort())
  })

  it('lists every variable in .env.example with an empty value', () => {
    const entries = readRepoFile('.env.example')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    expect(entries.every((line) => /^[A-Z][A-Z0-9_]*=$/.test(line))).toBe(true)
    expect(entries.map((line) => line.slice(0, -1)).sort()).toEqual([...envVariableNames].sort())
  })

  it('covers every variable in the complete fixture', () => {
    expect(Object.keys(complete).sort()).toEqual([...envVariableNames].sort())
  })
})

describe('safeLoadEnv', () => {
  it('returns the same data as loadEnv when the group is present', () => {
    const result = safeLoadEnv(['posthog'], complete)
    expect(result).toEqual({ success: true, data: loadEnv(['posthog'], complete) })
  })

  it('fails without throwing when keys are absent, with the same error loadEnv would throw', () => {
    const result = safeLoadEnv(['posthog'], without('POSTHOG_KEY'))
    expect(result.success).toBe(false)
    expect(!result.success && result.error.missing).toEqual(['POSTHOG_KEY'])
  })
})

describe('auth secret', () => {
  it('rejects a BETTER_AUTH_SECRET shorter than 32 characters', () => {
    const error = failure(() => loadEnv(['auth'], { ...complete, BETTER_AUTH_SECRET: 'short' }))
    expect(error.invalid).toEqual(['BETTER_AUTH_SECRET'])
    expect(error.message).not.toContain('short')
  })
})
