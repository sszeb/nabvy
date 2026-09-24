import { describe, expect, it } from 'vitest'
import { ACCOUNT_RESTRICTED_NOTICE, errorKinds, errorPages, isErrorKind } from '@/lib/errors'

// Copy rules for the error pages (docs/web-app.md, "Copy rules"; docs/decisions.md, "Fair use,
// suspension and bans").

const pages = errorKinds.map((kind) => [kind, errorPages[kind]] as const)

describe('error pages', () => {
  it('cover the common client and server errors', () => {
    for (const code of [
      '400',
      '401',
      '403',
      '404',
      '408',
      '410',
      '429',
      '500',
      '502',
      '503',
      '504',
    ]) {
      expect(isErrorKind(code), code).toBe(true)
      expect(String(errorPages[code as keyof typeof errorPages].status)).toBe(code)
    }
  })

  it.each(pages)('%s: short, calm copy with no exclamation marks', (_kind, copy) => {
    const text = [copy.title, copy.description, copy.tag, copy.primary.label].join(' ')
    expect(text).not.toMatch(/!/)
    expect(text).not.toMatch(/\b(hurry|last chance|act now|don['’]t miss|worth|fair value)\b/i)
    expect(copy.title.length).toBeLessThanOrEqual(40)
    expect(copy.description.length).toBeLessThanOrEqual(160)
    expect(copy.primary.href).toMatch(/^(\/|mailto:)/)
  })

  it('server errors show a reference; client errors do not', () => {
    for (const [kind, copy] of pages) {
      expect('showsReference' in copy && copy.showsReference, kind).toBe(copy.status >= 500)
    }
  })

  it('the restricted notice is the vague message and nothing more', () => {
    const copy = errorPages.restricted
    expect(copy.description).toBe('Your account has been restricted under our terms.')
    expect(copy.description).toBe(ACCOUNT_RESTRICTED_NOTICE)
    expect(copy.plain).toBe(true)
    const text = [copy.title, copy.tag, copy.primary.label, copy.secondary.label].join(' ')
    expect(text).not.toMatch(/\b(ban|banned|suspend|suspended|until|reason|abuse|fraud|score)\b/i)
  })

  it('the generic 403 never hints at a restriction', () => {
    expect(errorPages['403'].description).not.toMatch(/restrict|ban|suspend/i)
  })
})
