import { describe, expect, it } from 'vitest'
import {
  agreedTime,
  epochToLondonDay,
  epochToLondonTime,
  icsDocument,
  londonToEpoch,
  navigationLinks,
  open,
  parseDataKey,
  proposedSlot,
  reminderSchedule,
  reminderText,
  seal,
  shiftDay,
  windowBounds,
} from '../src/domain'
import { TEST_KEY } from './support/database'

const key = parseDataKey(TEST_KEY)

describe('crypto', () => {
  it('seals and opens a value; two seals of the same value differ; a wrong key refuses', () => {
    const value = {
      postcode: 'PO21 1AA',
      addressText: '12 Sea Road',
      point: { lat: 50.78, lng: -0.67 },
    }
    const a = seal(key, value)
    const b = seal(key, value)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
    expect(open(key, a)).toEqual(value)
    expect(Buffer.from(a).toString('latin1')).not.toContain('PO21')
    expect(() => open(parseDataKey('ff'.repeat(32)), a)).toThrow(/does not open/)
    const tampered = new Uint8Array(a)
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1
    expect(() => open(key, tampered)).toThrow(/does not open/)
  })

  it('accepts a 64-hex or a base64 32-byte key and refuses anything else', () => {
    expect(parseDataKey(TEST_KEY)).toHaveLength(32)
    expect(parseDataKey(Buffer.from(TEST_KEY, 'hex').toString('base64'))).toHaveLength(32)
    expect(() => parseDataKey('short')).toThrow(/32 bytes/)
    expect(() => parseDataKey('a'.repeat(63))).toThrow(/32 bytes/)
  })
})

describe('time', () => {
  it('converts Europe/London wall clock across BST and GMT', () => {
    expect(new Date(londonToEpoch('2026-09-26', '10:30') * 1000).toISOString()).toBe(
      '2026-09-26T09:30:00.000Z',
    )
    expect(new Date(londonToEpoch('2026-12-01', '10:30') * 1000).toISOString()).toBe(
      '2026-12-01T10:30:00.000Z',
    )
    expect(epochToLondonTime(londonToEpoch('2026-09-26', '10:30'))).toBe('10:30')
    expect(epochToLondonDay(londonToEpoch('2026-09-26', '00:10'))).toBe('2026-09-26')
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('turns each window kind into hard bounds', () => {
    const dayStart = londonToEpoch('2026-09-26', '09:00')
    const finish = londonToEpoch('2026-09-26', '18:00')
    const at = londonToEpoch('2026-09-26', '14:00')
    expect(windowBounds('2026-09-26', { kind: 'at', start: '14:00' }, dayStart, finish)).toEqual({
      start: at - 300,
      end: at + 600,
    })
    expect(windowBounds('2026-09-26', { kind: 'after', start: '14:00' }, dayStart, finish)).toEqual(
      { start: at, end: finish },
    )
    expect(windowBounds('2026-09-26', { kind: 'before', end: '14:00' }, dayStart, finish)).toEqual({
      start: dayStart,
      end: at,
    })
    expect(windowBounds('2026-09-26', { kind: 'unagreed' }, dayStart, finish)).toEqual({
      start: null,
      end: null,
    })
    expect(agreedTime({ kind: 'before', end: '12:00' })).toBe('12:00')
    expect(proposedSlot(londonToEpoch('2026-09-26', '15:07'))).toEqual({
      start: '15:10',
      end: '15:30',
    })
  })
})

describe('reminders', () => {
  const pickup = {
    id: 'p1',
    label: 'RTX 3090 – Bognor',
    day: '2026-09-26',
    window: { kind: 'at' as const, start: '10:30' },
    status: 'arranged' as const,
  }

  it('schedules the evening before, leave-by and not-agreed reminders idempotently by (kind, time)', () => {
    const plain = reminderSchedule(pickup, null)
    expect(plain.map((r) => r.kind)).toEqual(['evening_before', 'leave_by'])
    expect(epochToLondonTime(plain[0]?.dueAt ?? 0)).toBe('19:00')
    expect(epochToLondonDay(plain[0]?.dueAt ?? 0)).toBe('2026-09-25')
    expect(epochToLondonTime(plain[1]?.dueAt ?? 0)).toBe('09:30')
    const leaveAt = londonToEpoch('2026-09-26', '10:02')
    const planned = reminderSchedule(pickup, leaveAt)
    expect(epochToLondonTime(planned.find((r) => r.kind === 'leave_by')?.dueAt ?? 0)).toBe('09:52')
    const open = reminderSchedule({ ...pickup, window: { kind: 'unagreed' } }, null)
    expect(open.map((r) => r.kind)).toEqual(['evening_before', 'unagreed'])
    expect(reminderSchedule({ ...pickup, status: 'collected' }, null)).toEqual([])
  })

  it('carries the label and time only, never an address', () => {
    const others = [
      pickup,
      { ...pickup, id: 'p2', label: 'Monitor', window: { kind: 'unagreed' as const } },
    ]
    expect(reminderText('evening_before', pickup, others, null)).toBe(
      '2 pickups tomorrow · first at 10:30',
    )
    expect(reminderText('leave_by', pickup, others, londonToEpoch('2026-09-26', '10:02'))).toBe(
      "Leave by 10:02 for 'RTX 3090 – Bognor' at 10:30",
    )
    expect(reminderText('unagreed', pickup, others, null)).toBe(
      'One pickup tomorrow has no agreed time',
    )
    for (const kind of ['evening_before', 'leave_by', 'unagreed'] as const) {
      const text = reminderText(kind, pickup, others, null)
      expect(text).not.toMatch(/PO\d|Sea Road|\d{2}\.\d{4}/)
    }
  })
})

describe('ics and navigation', () => {
  it('writes one VEVENT per stop with a stable UID, the plan version as SEQUENCE and an alarm at departure', () => {
    const ics = icsDocument(
      { version: 3, day: '2026-09-26', createdAt: '2026-09-25T12:00:00.000Z' },
      [
        {
          pickupId: 'a1',
          label: 'RTX 3090; Bognor',
          status: 'arranged',
          addressText: '12 Sea Road, Bognor',
          notes: null,
          arriveAt: '2026-09-26T09:30:00.000Z',
          departAt: '2026-09-26T09:40:00.000Z',
          leaveAt: '2026-09-26T09:02:00.000Z',
        },
        {
          pickupId: 'b2',
          label: 'Monitor',
          status: 'cancelled',
          addressText: null,
          notes: 'x',
          arriveAt: '2026-09-26T11:00:00.000Z',
          departAt: '2026-09-26T11:10:00.000Z',
          leaveAt: '2026-09-26T10:40:00.000Z',
        },
      ],
    )
    expect(ics).toContain('UID:pickup-a1@nabvy')
    expect(ics).toContain('SEQUENCE:3')
    expect(ics).toContain('DTSTART:20260926T093000Z')
    expect(ics).toContain('DTEND:20260926T094000Z')
    expect(ics).toContain('SUMMARY:RTX 3090\\; Bognor')
    expect(ics).toContain('LOCATION:12 Sea Road\\, Bognor')
    expect(ics).toContain('TRIGGER;VALUE=DATE-TIME:20260926T090200Z')
    expect(ics).toContain('STATUS:CANCELLED')
    expect(ics.split('BEGIN:VEVENT')).toHaveLength(3)
  })

  it('builds links from coordinates only and splits Google legs at 9 (desktop) or 3 (mobile) waypoints', () => {
    const start = { lat: 50.8365, lng: -0.7792 }
    const stops = Array.from({ length: 12 }, (_, i) => ({
      lat: 50.8 + i * 0.01,
      lng: -0.7 - i * 0.01,
    }))
    const desktop = navigationLinks(start, stops, start)
    expect(desktop.google).toHaveLength(2)
    expect(desktop.apple).toHaveLength(1)
    expect(desktop.wazeNext).toBe('https://waze.com/ul?ll=50.800000,-0.700000&navigate=yes')
    const mobile = navigationLinks(start, stops, null, { mobile: true })
    expect(mobile.google).toHaveLength(3)
    for (const link of [...desktop.google, ...desktop.apple, ...mobile.google]) {
      expect(link).toMatch(/^https:\/\/(www\.google\.com|maps\.apple\.com)\//)
      expect(link).not.toMatch(/road|PO\d/i)
    }
    expect(navigationLinks(start, [], null)).toEqual({ google: [], apple: [], wazeNext: null })
  })
})
