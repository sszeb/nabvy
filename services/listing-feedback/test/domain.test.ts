import { describe, expect, it } from 'vitest'
import { recordedKey } from '../src/domain'

describe('recordedKey', () => {
  it('is the verdict row id and its current verdict value', () => {
    expect(recordedKey('11111111-1111-1111-1111-111111111111', 'real_deal')).toBe(
      'listing-feedback.recorded:11111111-1111-1111-1111-111111111111@real_deal',
    )
  })

  it('changes when the verdict changes, for the same row id', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    expect(recordedKey(id, 'real_deal')).not.toBe(recordedKey(id, 'not_a_deal'))
  })

  it('is stable for a repeated call with the same id and verdict', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    expect(recordedKey(id, 'bought')).toBe(recordedKey(id, 'bought'))
  })
})
