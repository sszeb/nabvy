// Europe/London wall-clock to absolute time and back (search-map-routes.md §6.1: "absolute Unix
// seconds, converted from Europe/London only at the edges"). Pure: Intl only, no clock.

export const ZONE = 'Europe/London'

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function zoneParts(epochMs: number) {
  const parts = formatter.formatToParts(new Date(epochMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** The zone's offset from UTC at this instant, in ms. */
function offsetMs(epochMs: number): number {
  const p = zoneParts(epochMs)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(epochMs / 1000) * 1000
}

/** `YYYY-MM-DD` plus `HH:MM` in Europe/London, as epoch seconds. */
export function londonToEpoch(day: string, time: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  let epoch = guess - offsetMs(guess)
  const again = offsetMs(epoch)
  if (again !== offsetMs(guess)) epoch = guess - again
  return Math.floor(epoch / 1000)
}

/** Epoch seconds as `HH:MM` in Europe/London. */
export function epochToLondonTime(epoch: number): string {
  const p = zoneParts(epoch * 1000)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Epoch seconds as `YYYY-MM-DD` in Europe/London. */
export function epochToLondonDay(epoch: number): string {
  const p = zoneParts(epoch * 1000)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** The day before or after a `YYYY-MM-DD` (calendar arithmetic, zone-free). */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export const toIso = (epoch: number): string => new Date(epoch * 1000).toISOString()
export const fromIso = (iso: string): number => Math.floor(Date.parse(iso) / 1000)
