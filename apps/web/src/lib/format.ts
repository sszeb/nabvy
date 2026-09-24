import type { Currency, Money } from '@/data/types'

const TIME_ZONE = 'Europe/London'

const moneyFormatters: Record<Currency, Intl.NumberFormat> = {
  GBP: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }),
  EUR: new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }),
}

/** "£420" for whole amounts, "£419.99" otherwise. Pence and cents are integer minor units. */
export function formatMoney({ amountMinor, currency }: Money): string {
  const formatted = moneyFormatters[currency].format(amountMinor / 100)
  return amountMinor % 100 === 0 ? formatted.replace(/[.,]00$/, '') : formatted
}

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TIME_ZONE,
})

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: TIME_ZONE,
})

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIME_ZONE,
})

/** "14:02" in UK time, whatever the machine's zone. */
export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso))
}

/**
 * "14:02" when the moment falls on the same UK day as `asOf`, otherwise "23 Sep, 14:02".
 * `asOf` comes from the data layer so the output never depends on the machine clock.
 */
export function formatMoment(iso: string, asOf: string): string {
  const date = new Date(iso)
  const sameDay = dayKeyFormatter.format(date) === dayKeyFormatter.format(new Date(asOf))
  return sameDay ? formatTime(iso) : `${dayFormatter.format(date)}, ${formatTime(iso)}`
}

/** "3 km away"; distances are rounded to whole kilometres so they never pinpoint a place. */
export function formatDistance(distanceKm: number): string {
  const km = Math.max(1, Math.round(distanceKm))
  return `${km} km away`
}

/** "12 min", "2 h 5 min": a duration between two stamps, for freshness figures. */
export function formatDuration(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
