import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  errorKinds,
  errorPages,
  isErrorKind,
  parseRestriction,
  REVIEW_OFFER,
  restrictedNotice,
} from '@/lib/errors'

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

  it('the restricted notice names the step and policy only, and offers a review', () => {
    expect(restrictedNotice('suspended', 'fair-use')).toBe(
      'Your account has been suspended under our Fair Use Policy.',
    )
    expect(restrictedNotice('banned', 'terms')).toBe(
      'Your account has been banned under our Terms of Service.',
    )
    expect(REVIEW_OFFER).toBe('You can ask for a review within 30 days.')
    const copy = errorPages.restricted
    expect(copy.plain).toBe(true)
    expect(copy.primary.label).toBe('Ask for a review')
    const text = [copy.title, copy.tag, copy.description, copy.primary.label, copy.secondary.label]
    expect(text.join(' ')).not.toMatch(/\b(reason|abuse|fraud|score|until|evidence)\b/i)
  })

  it('reads only a known step and policy from the address', () => {
    expect(parseRestriction({ step: 'suspended', policy: 'fair-use' })).toEqual({
      step: 'suspended',
      policy: 'fair-use',
    })
    expect(parseRestriction({ step: 'suspended', policy: 'because we said so' })).toBeNull()
    expect(parseRestriction({ step: 'kicked', policy: 'terms' })).toBeNull()
    expect(parseRestriction({ step: ['banned'], policy: 'terms' })).toBeNull()
    expect(parseRestriction({})).toBeNull()
  })

  it('server error pages show the opaque digest, never the message or stack', () => {
    for (const file of ['error.tsx', 'global-error.tsx']) {
      const source = readFileSync(new URL(`../src/app/${file}`, import.meta.url), 'utf8')
      expect(source, file).toMatch(/reference=\{error\.digest\}/)
      expect(source, file).not.toMatch(/error\.(message|stack|cause)/)
    }
  })

  it('the generic 403 never hints at a restriction', () => {
    expect(errorPages['403'].description).not.toMatch(/restrict|ban|suspend/i)
  })
})
