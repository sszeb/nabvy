import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EnvError, type EnvGroup, envGroups, envVariableNames, loadEnv } from '../src'
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

  it('applies the configuration defaults from docs/secrets.md, but never to secrets', () => {
    const groups = ['spendCaps', 'cex', 'models', 'postcodes', 'posthog', 'testing'] as const
    expect(failure(() => loadEnv(groups, {})).missing).toEqual(['ANTHROPIC_API_KEY', 'POSTHOG_KEY'])

    const env = loadEnv(groups, { ANTHROPIC_API_KEY: 'placeholder', POSTHOG_KEY: 'placeholder' })
    expect(env).toEqual({
      ANTHROPIC_API_KEY: 'placeholder',
      POSTHOG_KEY: 'placeholder',
      POSTHOG_HOST: 'https://eu.i.posthog.com',
      FB_DAILY_CAP_MINOR: 1000,
      GUMTREE_DAILY_CAP_MINOR: 500,
      SCAN_SPEND_CAP_MINOR: 5,
      CEX_API_BASE: 'https://wss2.cex.uk.webuy.io/v3',
      CEX_DAILY_CAP_CALLS: 300,
      MODEL_DEFAULT: 'claude-haiku-4-5-20251001',
      MODEL_ESCALATION: 'claude-sonnet-5',
      MODEL_VISION: 'claude-sonnet-5',
      POSTCODES_IO_BASE: 'https://api.postcodes.io',
      LIVE_PROVIDERS: false,
    })
  })

  it('reports malformed values as invalid without echoing them', () => {
    const secretLookingValue = 'mysql://nabvy_app:hunter2@db.example.com/postgres'
    const error = failure(() =>
      loadEnv(['database', 'ebay', 'apify'], {
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
