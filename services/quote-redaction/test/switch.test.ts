import { describe, expect, it } from 'vitest'
import { quoteFor, redact } from '../src/index'

// Fail closed (card "When off"): no quote and no model text unless the switch reads 'on'.
describe('quoteFor', () => {
  const text = 'Call 07700 900123'

  it('masks while the switch is on', () => {
    expect(quoteFor(text, 'on')).toEqual(redact(text))
  })

  it.each(['off', 'shadow', null, undefined] as const)(
    'returns nothing when the switch is %s',
    (state) => {
      expect(quoteFor(text, state)).toBeNull()
    },
  )
})
