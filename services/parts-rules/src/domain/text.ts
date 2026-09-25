// The working copy of a stored text: NFKC, horizontal whitespace collapsed, line breaks unified,
// and `+` read as a space when the text has `+` and no spaces. The stored text is never changed:
// every working character keeps the offsets of the stored code point it came from, so a hit in
// the working copy maps back to a verbatim quote of the stored text.

export interface Working {
  /** The stored text. */
  original: string
  /** The working copy the rules read. Blanked spans are replaced by spaces of equal length. */
  text: string
  /** For each working UTF-16 unit, the stored start and end offsets of its code point. */
  starts: number[]
  ends: number[]
  /** Whether `+` was read as a space. */
  plusAsSpace: boolean
}

/**
 * `+` is read as a space only when the text has `+` and no space at all, as in the recorded row
 * `1756692548940192` ("MSI+AlphaSync+GTX+1660,+Ryzen+7+2700X+Gaming+PC",
 * fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:466).
 */
export function readsPlusAsSpace(text: string): boolean {
  const nfkc = text.normalize('NFKC')
  return nfkc.includes('+') && !nfkc.includes(' ')
}

const LINE_BREAK = /^[\n\u2028\u2029\u0085\v\f]$/
const HORIZONTAL_SPACE = /^\s$/

export function workingCopy(original: string): Working {
  const plusAsSpace = readsPlusAsSpace(original)
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  const push = (unit: string, start: number, end: number) => {
    text += unit
    starts.push(start)
    ends.push(end)
  }
  let i = 0
  for (const cp of original) {
    const start = i
    const end = i + cp.length
    i = end
    let nf = cp.normalize('NFKC')
    if (cp === '\r') nf = original[end] === '\n' ? '' : '\n'
    else if (LINE_BREAK.test(nf)) nf = '\n'
    else if (HORIZONTAL_SPACE.test(nf) || (plusAsSpace && nf === '+')) nf = ' '
    if (nf === ' ' && (text.endsWith(' ') || text.endsWith('\n') || text === '')) continue
    if (nf === '\n' && text.endsWith(' ')) {
      text = text.slice(0, -1)
      starts.pop()
      ends.pop()
    }
    for (const unit of nf) {
      for (let k = 0; k < unit.length; k++) push(unit[k] as string, start, end)
    }
  }
  return { original, text, starts, ends, plusAsSpace }
}

/** The stored offsets and verbatim quote of the working span [start, end). */
export function located(w: Working, start: number, end: number) {
  const from = w.starts[start] ?? 0
  const to = w.ends[end - 1] ?? from
  return { start: from, end: to, quote: w.original.slice(from, to) }
}

/** Replaces the working span [start, end) with spaces (line breaks kept), keeping offsets. */
export function blank(w: Working, start: number, end: number): void {
  w.text =
    w.text.slice(0, start) + w.text.slice(start, end).replace(/[^\n]/g, ' ') + w.text.slice(end)
}

/** Each line of the working copy with its working offset. */
export function lines(w: Working): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = []
  let offset = 0
  for (const line of w.text.split('\n')) {
    out.push({ text: line, offset })
    offset += line.length + 1
  }
  return out
}
