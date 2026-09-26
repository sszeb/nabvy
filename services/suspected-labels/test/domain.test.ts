import type { SuspectedLabelsTgtbtSignal } from '@nabvy/contracts/modules/suspected-labels'
import { describe, expect, it } from 'vitest'
import { evaluateTgtbtSignals, hasSignal, type SignalEvidenceItem } from '../src/domain/index'

describe('suspected-labels domain logic', () => {
  describe('evaluateTgtbtSignals', () => {
    it('detects path A: two independent listing signals', () => {
      const signals: SignalEvidenceItem[] = [
        {
          signal: 'location_mismatch' as SuspectedLabelsTgtbtSignal,
          state: 'present',
          support: 'strong',
          source: 'listing',
        },
        {
          signal: 'delivery_conflict_with_collection' as SuspectedLabelsTgtbtSignal,
          state: 'present',
          support: 'strong',
          source: 'listing',
        },
      ]

      const result = evaluateTgtbtSignals(signals)
      expect(result.path).toBe('A')
      expect(result.would_show).toBe(true)
    })

    it('detects path B: one report + one listing signal', () => {
      const signals: SignalEvidenceItem[] = [
        {
          signal: 'location_mismatch' as SuspectedLabelsTgtbtSignal,
          state: 'present',
          support: 'strong',
          source: 'listing',
        },
      ]

      const result = evaluateTgtbtSignals(signals, 1)
      expect(result.path).toBe('B')
      expect(result.would_show).toBe(true)
    })

    it('detects path C: multiple reports', () => {
      const signals: SignalEvidenceItem[] = []

      const result = evaluateTgtbtSignals(signals, 2)
      expect(result.path).toBe('C')
      expect(result.would_show).toBe(true)
    })

    it('detects path B-P: one report + price signal (review-only)', () => {
      const signals: SignalEvidenceItem[] = [
        {
          signal: 'ask_far_below_comparable' as SuspectedLabelsTgtbtSignal,
          state: 'present',
          support: 'strong',
          source: 'listing',
        },
      ]

      const result = evaluateTgtbtSignals(signals, 1)
      expect(result.path).toBe('B-P')
      expect(result.would_show).toBe(false)
    })

    it('returns no path when insufficient evidence', () => {
      const signals: SignalEvidenceItem[] = [
        {
          signal: 'location_mismatch' as SuspectedLabelsTgtbtSignal,
          state: 'present',
          support: 'strong',
          source: 'listing',
        },
      ]

      const result = evaluateTgtbtSignals(signals, 0)
      expect(result.path).toBeNull()
      expect(result.would_show).toBe(false)
    })

    it('ignores absent signals', () => {
      const signals: SignalEvidenceItem[] = [
        {
          signal: 'location_mismatch' as SuspectedLabelsTgtbtSignal,
          state: 'present',
          support: 'strong',
          source: 'listing',
        },
        {
          signal: 'risky_payment_request' as SuspectedLabelsTgtbtSignal,
          state: 'absent',
          support: 'weak',
          source: 'listing',
        },
      ]

      const result = evaluateTgtbtSignals(signals, 0)
      expect(result.path).toBeNull()
    })
  })

  describe('hasSignal', () => {
    it('returns true when signal is present', () => {
      const signals: SignalEvidenceItem[] = [
        {
          signal: 'location_mismatch' as SuspectedLabelsTgtbtSignal,
          state: 'present',
          support: 'strong',
          source: 'listing',
        },
      ]

      expect(hasSignal('location_mismatch' as SuspectedLabelsTgtbtSignal, signals)).toBe(true)
    })

    it('returns false when signal is absent', () => {
      const signals: SignalEvidenceItem[] = [
        {
          signal: 'location_mismatch' as SuspectedLabelsTgtbtSignal,
          state: 'absent',
          support: 'strong',
          source: 'listing',
        },
      ]

      expect(hasSignal('location_mismatch' as SuspectedLabelsTgtbtSignal, signals)).toBe(false)
    })

    it('returns false when signal is not in list', () => {
      const signals: SignalEvidenceItem[] = []

      expect(hasSignal('location_mismatch' as SuspectedLabelsTgtbtSignal, signals)).toBe(false)
    })
  })
})
