import { z } from 'zod'

// Every variable in docs/secrets.md, grouped by the part of the system that needs it. A service
// asks only for its own groups, so the web app does not fail at start-up for want of an eBay key.
// Defaults are the configuration values docs/secrets.md states; secrets never have defaults.

const required = () => z.string().min(1)
const postgresUrl = () => z.url({ protocol: /^postgres(ql)?$/ })
const httpsUrl = () => z.url({ protocol: /^https$/ })
const count = () => z.coerce.number().int().nonnegative()
const flag = () => z.stringbool()
const emailList = () =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.email()).min(1))

export const envGroups = {
  database: z.object({ DATABASE_URL: postgresUrl() }),
  pipelineDatabase: z.object({ DATABASE_URL_PIPELINE: postgresUrl() }),
  storage: z.object({ SUPABASE_URL: httpsUrl(), SUPABASE_SERVICE_ROLE_KEY: required() }),
  auth: z.object({
    BETTER_AUTH_SECRET: required(),
    BETTER_AUTH_URL: z.url(),
    ADMIN_EMAILS: emailList(),
  }),
  captcha: z.object({ TURNSTILE_SITE_KEY: required(), TURNSTILE_SECRET_KEY: required() }),
  googleOAuth: z.object({
    GOOGLE_OAUTH_CLIENT_ID: required(),
    GOOGLE_OAUTH_CLIENT_SECRET: required(),
  }),
  trigger: z.object({ TRIGGER_SECRET_KEY: required(), TRIGGER_PROJECT_ID: required() }),
  apify: z.object({
    APIFY_TOKEN: required(),
    APIFY_FB_ACTOR_ID: required(),
    USD_GBP_RATE: z.coerce.number().positive(),
  }),
  apifyFacebookFallback: z.object({ APIFY_FB_ACTOR_FALLBACK_ID: required() }),
  apifyGumtree: z.object({ APIFY_GUMTREE_ACTOR_ID: required() }),
  sellerHash: z.object({ SELLER_HASH_SALT: required() }),
  spendCaps: z.object({
    FB_DAILY_CAP_MINOR: count().default(1000),
    GUMTREE_DAILY_CAP_MINOR: count().default(500),
    SCAN_SPEND_CAP_MINOR: count().default(5),
  }),
  ebay: z.object({
    EBAY_CLIENT_ID: required(),
    EBAY_CLIENT_SECRET: required(),
    EBAY_RUNAME: required(),
    EBAY_ENV: z.enum(['sandbox', 'production']),
    EBAY_INSIGHTS_ENABLED: flag().default(false),
    EBAY_EPN_CAMPAIGN_ID: required(),
  }),
  cex: z.object({
    CEX_API_BASE: httpsUrl().default('https://wss2.cex.uk.webuy.io/v3'),
    CEX_DAILY_CAP_CALLS: count().default(300),
  }),
  models: z.object({
    ANTHROPIC_API_KEY: required(),
    MODEL_DEFAULT: required().default('claude-haiku-4-5-20251001'),
    MODEL_ESCALATION: required().default('claude-sonnet-5'),
    MODEL_VISION: required().default('claude-sonnet-5'),
  }),
  langfuse: z.object({
    LANGFUSE_PUBLIC_KEY: required(),
    LANGFUSE_SECRET_KEY: required(),
    LANGFUSE_HOST: httpsUrl(),
  }),
  telegram: z.object({ TELEGRAM_BOT_TOKEN: required() }),
  founderTelegram: z.object({ FOUNDER_TELEGRAM_CHAT_ID: required() }),
  discord: z.object({ DISCORD_BOT_TOKEN: required() }),
  webPush: z.object({
    VAPID_PUBLIC_KEY: required(),
    VAPID_PRIVATE_KEY: required(),
    VAPID_SUBJECT: required(),
  }),
  email: z.object({ RESEND_API_KEY: required(), RESEND_WEBHOOK_SECRET: required() }),
  stripe: z.object({
    STRIPE_SECRET_KEY: required(),
    STRIPE_WEBHOOK_SECRET: required(),
    STRIPE_PRICE_STANDARD_MONTHLY: required(),
    STRIPE_PRICE_STANDARD_ANNUAL: required(),
    STRIPE_PRICE_PRO_MONTHLY: required(),
    STRIPE_PRICE_PRO_ANNUAL: required(),
    STRIPE_PRICE_BUSINESS_MONTHLY: required(),
    STRIPE_PRICE_BUSINESS_ANNUAL: required(),
    STRIPE_PRICE_EXTRA_AREA: required(),
    STRIPE_PRICE_TOPUP_5: required(),
    STRIPE_PRICE_TOPUP_10: required(),
    STRIPE_PRICE_TOPUP_25: required(),
  }),
  stripePublic: z.object({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: required() }),
  dub: z.object({ DUB_API_KEY: required(), DUB_PROGRAM_ID: required() }),
  dubPublic: z.object({ NEXT_PUBLIC_DUB_DOMAIN: required() }),
  postcodes: z.object({ POSTCODES_IO_BASE: httpsUrl().default('https://api.postcodes.io') }),
  sentry: z.object({ SENTRY_DSN: httpsUrl() }),
  posthog: z.object({
    POSTHOG_KEY: required(),
    POSTHOG_HOST: httpsUrl().default('https://eu.i.posthog.com'),
  }),
  tokenEncryption: z.object({ TOKEN_ENCRYPTION_KEY: required() }),
  testing: z.object({ LIVE_PROVIDERS: flag().default(false) }),
} as const

export type EnvGroup = keyof typeof envGroups

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I,
) => void
  ? I
  : never

/** The validated variables for the requested groups, merged into one object. */
export type Env<G extends EnvGroup> = UnionToIntersection<
  { [K in G]: z.output<(typeof envGroups)[K]> }[G]
>

export type EnvSource = Readonly<Record<string, string | undefined>>

/** Every variable name the application reads, in declaration order. */
export const envVariableNames: readonly string[] = Object.values(envGroups).flatMap((group) =>
  Object.keys(group.shape),
)

/**
 * Thrown when variables are missing or malformed. The message names the variables and the
 * reason, never their values, so it is safe to log.
 */
export class EnvError extends Error {
  readonly missing: readonly string[]
  readonly invalid: readonly string[]

  constructor(missing: readonly string[], invalid: readonly { name: string; reason: string }[]) {
    const parts: string[] = []
    if (missing.length) parts.push(`missing ${missing.join(', ')}`)
    if (invalid.length) {
      parts.push(`invalid ${invalid.map(({ name, reason }) => `${name} (${reason})`).join(', ')}`)
    }
    super(`Environment check failed: ${parts.join('; ')}. See docs/secrets.md.`)
    this.name = 'EnvError'
    this.missing = missing
    this.invalid = invalid.map(({ name }) => name)
  }
}

/**
 * Validates the variables for the given groups and returns them typed. Call once at start-up.
 * Empty values count as unset, so a copied `.env.example` fails fast rather than passing ''.
 */
export function loadEnv<G extends EnvGroup>(
  groups: readonly G[],
  source: EnvSource = process.env,
): Env<G> {
  const shape = Object.assign({}, ...groups.map((group) => envGroups[group].shape))
  const names = Object.keys(shape)
  const present = Object.fromEntries(
    names.flatMap((name) => {
      const value = source[name]
      return value === undefined || value.trim() === '' ? [] : [[name, value]]
    }),
  )

  const result = z.object(shape).safeParse(present)
  if (result.success) return result.data as Env<G>

  const missing = new Set<string>()
  const invalid = new Map<string, string>()
  for (const issue of result.error.issues) {
    const name = String(issue.path[0])
    if (name in present) {
      if (!invalid.has(name)) invalid.set(name, issue.message)
    } else {
      missing.add(name)
    }
  }
  throw new EnvError(
    names.filter((name) => missing.has(name)),
    names.flatMap((name) => {
      const reason = invalid.get(name)
      return reason === undefined ? [] : [{ name, reason }]
    }),
  )
}
