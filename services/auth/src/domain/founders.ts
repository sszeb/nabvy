/**
 * Founder bootstrap (docs/security.md): addresses in ADMIN_EMAILS receive the admin role on
 * sign-in. Compared case-insensitively and trimmed, as `better_auth.seed_founders` does.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isFounderEmail(email: string, adminEmails: readonly string[]): boolean {
  const address = normaliseEmail(email)
  return address !== '' && adminEmails.some((admin) => normaliseEmail(admin) === address)
}
