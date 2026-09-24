import type { Metadata } from 'next'
import { ErrorPage } from '@/components/error-page'
import { parseRestriction, RESTRICTED_FALLBACK, REVIEW_OFFER, restrictedNotice } from '@/lib/errors'

/**
 * The account-restricted notice (docs/decisions.md, "Fair use, suspension and bans"). The session
 * helpers' refusal carries the step and the policy; the app redirects here with them, for example
 * /errors/restricted?step=suspended&policy=fair-use. Anything else in the address is ignored, so
 * the page can never show a reason, rule, date or score.
 */
export const metadata: Metadata = { title: 'Account restricted', robots: { index: false } }

export default async function RestrictedPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | string[]; policy?: string | string[] }>
}) {
  const restriction = parseRestriction(await searchParams)
  return (
    <ErrorPage
      kind="restricted"
      description={
        restriction ? restrictedNotice(restriction.step, restriction.policy) : RESTRICTED_FALLBACK
      }
      note={REVIEW_OFFER}
    />
  )
}
