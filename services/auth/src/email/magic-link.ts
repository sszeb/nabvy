/** A sign-in link on its way to an address. */
export interface MagicLink {
  email: string
  url: string
  /** The plain-text body, from `magicLinkText`. */
  text: string
}

/** Delivers magic links. Better Auth calls `send` from its `/sign-in/magic-link` endpoint. */
export interface MagicLinkSender {
  send(link: MagicLink): Promise<void>
}

/** Test double: keeps every link in memory instead of sending it. Never use in production. */
export interface RecordingMagicLinkSender extends MagicLinkSender {
  readonly sent: readonly MagicLink[]
  /** The newest link sent to an address, if any. */
  latestFor(email: string): MagicLink | undefined
}

export function createRecordingMagicLinkSender(): RecordingMagicLinkSender {
  const sent: MagicLink[] = []
  return {
    sent,
    async send(link) {
      sent.push({ ...link })
    },
    latestFor(email) {
      const address = email.trim().toLowerCase()
      return sent.findLast((link) => link.email.trim().toLowerCase() === address)
    },
  }
}

export interface ResendSenderOptions {
  apiKey: string
  /** Sender address on the transactional domain (docs/secrets.md, `mail.nabvy.com`). */
  from?: string
  fetch?: typeof fetch
}

export const MAGIC_LINK_FROM = 'Nabvy <sign-in@mail.nabvy.com>'
export const MAGIC_LINK_SUBJECT = 'Your Nabvy sign-in link'

/**
 * The plain-text body, with the lifetime taken from the link's real expiry so the two cannot
 * drift. Wording is provisional until the owner confirms it (docs/questions.md).
 */
export function magicLinkText(url: string, expiresInSeconds: number): string {
  const minutes = Math.round(expiresInSeconds / 60)
  return [
    `Use this link to sign in to Nabvy. It works once and expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    '',
    url,
    '',
    'If you did not ask to sign in, you can ignore this email.',
  ].join('\n')
}

/**
 * Sends magic links through Resend's email API (docs/decisions.md: transactional email on
 * Resend). The error names the status only, never the address or the link.
 */
export function createResendMagicLinkSender(options: ResendSenderOptions): MagicLinkSender {
  const post = options.fetch ?? fetch
  return {
    async send({ email, text }) {
      const response = await post('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from ?? MAGIC_LINK_FROM,
          to: [email],
          subject: MAGIC_LINK_SUBJECT,
          text,
        }),
      })
      if (!response.ok) throw new Error(`Resend refused the magic-link email (${response.status})`)
    },
  }
}
