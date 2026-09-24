/**
 * Copy for every error page (task 4.1b). One entry per HTTP status the app can show, plus the
 * account-restricted notice. The pattern is the one big tech uses: the code as a graphic, a
 * short human headline, one or two sentences saying what happened and what to do, one main
 * action, and a reference for server errors. Wording is Nabvy's own, in the deal-hunting
 * register, following the copy rules (no exclamation marks, no urgency, UK English).
 */

export type ErrorAction = { label: string; href: string }

export type ErrorPageCopy = {
  /** HTTP status, shown on the tag and in the footer line. */
  status: number
  /** Short label printed under the code on the tag. */
  tag: string
  title: string
  description: string
  primary: ErrorAction
  secondary?: ErrorAction
  /** Server-side failures show a reference so support can find the log line. */
  showsReference?: boolean
  /** Plain, illustration-free layout (the account-restricted notice). */
  plain?: boolean
}

const dashboard: ErrorAction = { label: 'Go to your dashboard', href: '/app' }
const home: ErrorAction = { label: 'Nabvy home', href: '/' }
const signIn: ErrorAction = { label: 'Sign in', href: '/sign-in' }
const contact: ErrorAction = { label: 'Contact us', href: 'mailto:hello@nabvy.com' }

/**
 * The account-restricted notice. It must stay word for word the auth module's
 * ACCOUNT_RESTRICTED_MESSAGE (`@nabvy/contracts/modules/auth`, PR #9), and never gains a reason,
 * rule, date or score (docs/decisions.md, "Fair use, suspension and bans"). It is imported from
 * the contract once that pull request is merged.
 */
export const ACCOUNT_RESTRICTED_NOTICE = 'Your account has been restricted under our terms.'

export const errorPages = {
  '400': {
    status: 400,
    tag: 'Bad request',
    title: 'That link looks a bit mangled',
    description:
      "Something in the request didn't come through the way we expected. Check the address, or go back and try again.",
    primary: dashboard,
    secondary: home,
  },
  '401': {
    status: 401,
    tag: 'Sign in',
    title: 'Sign in to carry on',
    description:
      "This page is for signed-in members. Your session may have ended, or you haven't signed in on this device yet.",
    primary: signIn,
    secondary: home,
  },
  '403': {
    status: 403,
    tag: 'No access',
    title: 'This aisle is staff only',
    description:
      "Your account doesn't have access to this page. If you think it should, get in touch and we'll take a look.",
    primary: dashboard,
    secondary: contact,
  },
  '404': {
    status: 404,
    tag: 'Not found',
    title: 'This one got away',
    description:
      "We looked everywhere, but the page you're after isn't here. The link may be old, or the listing may have been removed.",
    primary: dashboard,
    secondary: home,
  },
  '408': {
    status: 408,
    tag: 'Timed out',
    title: 'That took too long',
    description: 'Your browser waited too long for a reply. Check your connection, then try again.',
    primary: dashboard,
    secondary: home,
  },
  '410': {
    status: 410,
    tag: 'Gone',
    title: 'Gone for good',
    description:
      "This page was taken down on purpose and isn't coming back. Your hunts will keep finding new things.",
    primary: dashboard,
    secondary: home,
  },
  '429': {
    status: 429,
    tag: 'Slow down',
    title: 'One thing at a time',
    description:
      'That was a lot of requests in a short time. Take a breather and try again in a minute.',
    primary: dashboard,
    secondary: home,
  },
  '500': {
    status: 500,
    tag: 'Server error',
    title: 'Something broke on our side',
    description:
      "It's not you, it's us. The problem has been logged and we're looking into it. Try again in a moment.",
    primary: dashboard,
    secondary: home,
    showsReference: true,
  },
  '502': {
    status: 502,
    tag: 'Bad gateway',
    title: 'Crossed wires',
    description:
      'One of our servers got a garbled reply from another. It usually sorts itself out quickly, so try again shortly.',
    primary: dashboard,
    secondary: home,
    showsReference: true,
  },
  '503': {
    status: 503,
    tag: 'Back soon',
    title: 'Back shortly',
    description:
      'Nabvy is having some maintenance or is very busy right now. Your hunts and alerts are saved.',
    primary: home,
    showsReference: true,
  },
  '504': {
    status: 504,
    tag: 'Timed out',
    title: 'The line went quiet',
    description: "A server we rely on didn't answer in time. Try again in a moment.",
    primary: dashboard,
    secondary: home,
    showsReference: true,
  },
  restricted: {
    status: 403,
    tag: 'Restricted',
    title: 'Account restricted',
    description: ACCOUNT_RESTRICTED_NOTICE,
    primary: home,
    secondary: contact,
    plain: true,
  },
} as const satisfies Record<string, ErrorPageCopy>

export type ErrorKind = keyof typeof errorPages

export const errorKinds = Object.keys(errorPages) as ErrorKind[]

export function isErrorKind(value: string): value is ErrorKind {
  return Object.hasOwn(errorPages, value)
}
