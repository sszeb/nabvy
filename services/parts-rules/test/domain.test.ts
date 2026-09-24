import { getPack } from '@nabvy/packs'
import { describe, expect, it } from 'vitest'
import {
  analyse,
  attributeLabel,
  compileRules,
  decideKind,
  gpuKey,
  inclusionOf,
  lineLabel,
  numbersAgree,
  partGaps,
  type RuleSettings,
  ranKey,
  ruleVersion,
  type Signal,
  workingCopy,
} from '../src/domain'

// The pure rule pass: the working copy and its offsets, tag blocks, the OptiPlex trap, spec-line
// labels, inclusion candidates, listing kind, gaps and keys.

const pack = getPack('gpu-pc').definition.rules
const RULES = compileRules(pack.partPatterns)
const SETTINGS: RuleSettings = {
  contextChars: 80,
  wantedDescriptionChars: 400,
  tagBlockMinHashtags: 3,
  tagBlockMinModels: 4,
}
const run = (
  title: string,
  description: string | null = null,
  attributes: { name: string | null; label: string | null; value: string | null }[] = [],
  negatives: string[] = [],
) => analyse({ title, description, attributes, detailSections: [] }, RULES, SETTINGS, negatives)
const parts = (a: ReturnType<typeof run>, type?: string) =>
  a.hits.filter((h) => !type || h.partType === type).map((h) => h.quote)

describe('working copy', () => {
  it('reads + as a space only when the text has + and no spaces', () => {
    const w = workingCopy('MSI+AlphaSync+GTX+1660,+Ryzen+7+2700X+Gaming+PC')
    expect(w.plusAsSpace).toBe(true)
    expect(w.text).toBe('MSI AlphaSync GTX 1660, Ryzen 7 2700X Gaming PC')
    expect(workingCopy('Corsair 750W 80+ Gold').plusAsSpace).toBe(false)
    expect(workingCopy('Corsair 750W 80+ Gold').text).toBe('Corsair 750W 80+ Gold')
  })

  it('applies NFKC and collapses whitespace, quoting the stored text verbatim', () => {
    const stored = 'GPU:\t\tＲＴＸ　３０８０ \r\nRAM'
    const a = run('x', stored)
    const [gpu] = a.hits.filter((h) => h.partType === 'gpu')
    expect(gpu?.reading).toBe('RTX 3080')
    expect(gpu?.quote).toBe('ＲＴＸ　３０８０')
    expect(stored.slice(gpu?.start, gpu?.end)).toBe(gpu?.quote)
  })

  it('never changes the stored text: every quote is the stored slice', () => {
    const title = 'MSI+AlphaSync+GTX+1660,+Ryzen+7+2700X+Gaming+PC'
    const a = run(title)
    expect(parts(a)).toEqual(['GTX+1660', 'Ryzen+7+2700X'])
    for (const h of a.hits) expect(title.slice(h.start, h.end)).toBe(h.quote)
  })
})

describe('traps', () => {
  it('removes OptiPlex 3080/3090 before GPU matching, even with no catalogue negatives', () => {
    const a = run('Dell OptiPlex 3090 i5-10500 office PC', 'Dell OptiPlex 3080 Micro, 8GB RAM')
    expect(parts(a, 'gpu')).toEqual([])
    const b = run('Dell OptiPlex 7090 with RTX 3090', null, [], [String.raw`\boptiplex\s*\d{4}\b`])
    expect(parts(b, 'gpu')).toEqual(['RTX 3090'])
  })

  it('ignores hashtag tag blocks, labelled keyword blocks and model lists', () => {
    const description = [
      'GPU: RTX 3060 12GB',
      '',
      '#rtx4090 #rtx4080 #5080 #gamingpc',
      '',
      'Tags: rtx 5090, i9 14900k, 64gb ddr5',
      'ryzen 9 7950x3d',
      '',
      '3060 3070 3080 3090 4070 4080 gaming',
      'CPU: Ryzen 5 5600X',
    ].join('\n')
    const a = run('Gaming PC', description)
    expect(parts(a, 'gpu')).toEqual(['RTX 3060'])
    expect(parts(a, 'cpu')).toEqual(['Ryzen 5 5600X'])
    expect(parts(a, 'ram_size')).toEqual([])
    expect(a.tagBlocks.map((b) => b.ruleId)).toEqual([
      'tag.hashtags',
      'tag.label',
      'tag.model-list',
    ])
    for (const b of a.tagBlocks)
      expect(description.slice(b.start, b.end).length).toBe(b.end - b.start)
  })

  it('keeps one or two inline hashtags readable', () => {
    expect(parts(run('Gaming PC', '#RTX3070 build with #ryzen'), 'gpu')).toEqual(['RTX3070'])
    expect(run('Gaming PC', 'RTX 3070 #gaming #pc').tagBlocks).toEqual([])
  })

  it('reads GDDR as graphics memory, never system RAM', () => {
    const a = run('x', 'NVIDIA GeForce RTX 5060 8GB GDDR7\nRX 580 8GB GDDR5 card')
    expect(parts(a, 'ram_size')).toEqual([])
    expect(parts(a, 'ram_generation')).toEqual([])
  })

  it('reads a size running into a GPU model as the card memory', () => {
    const a = run('x', 'Amd Ryzen 7700x 32gb ddr5 2x16gb ram Msi gaming trio 12gb 5070')
    expect(parts(a, 'ram_size')).toEqual(['32gb ddr5', '2x16gb'])
  })

  it('matches GPU model numbers only inside a GPU-model hit', () => {
    const a = run('x', 'Order 5080123, ref 45080, RTX 5080 16GB')
    expect(parts(a, 'gpu')).toEqual(['RTX 5080'])
    expect(a.hits.find((h) => h.partType === 'gpu')?.attrs.model).toBe('RTX 5080')
  })
})

describe('spec lines', () => {
  it('reads a label and the parts it allows', () => {
    expect(lineLabel('Graphics Card: NVIDIA GeForce GTX 970 4GB')).toEqual(['gpu'])
    expect(lineLabel('* CPU: AMD Ryzen 7 9800X3D')).toEqual(['cpu'])
    expect(lineLabel('CPU Cooler: Corsair Nautilus 360')).toEqual([])
    expect(lineLabel('Ram- ddr4 16gb')).toEqual(['ram_size', 'ram_generation'])
    expect(lineLabel('Storage 928GB')).toBeNull()
    expect(lineLabel('Power supply 750 watt - working')).toBeNull()
    expect(attributeLabel('Processor type')).toEqual(['cpu'])
    expect(attributeLabel('Condition')).toEqual([])
    expect(attributeLabel('Something new')).toBeNull()
  })

  it('drops hits in a line labelled for another part', () => {
    const a = run(
      'x',
      'Graphics Card: NVIDIA GeForce GTX 970 4GB\nRAM: 8GB DDR3\nCase: Corsair 4500X\nMotherboard: MSI Z790 (DDR5)',
    )
    expect(parts(a, 'ram_size')).toEqual(['RAM: 8GB'])
    expect(parts(a, 'ram_generation')).toEqual(['DDR3'])
    expect(parts(a, 'cpu')).toEqual([])
    expect(parts(a, 'chipset')).toEqual(['Z790'])
  })

  it('reads structured attributes before the title and description', () => {
    const a = run('Gaming PC bundle', 'CPU: AMD Ryzen 5 3600', [
      { name: 'Condition', label: 'Used – good', value: 'used_good' },
      { name: 'Processor type', label: 'AMD Ryzen 5 3600', value: 'AMD Ryzen 5 3600' },
    ])
    expect(a.hits.map((h) => `${h.source}:${h.quote}`)).toEqual([
      'attribute:Ryzen 5 3600',
      'description:Ryzen 5 3600',
    ])
    expect(a.hits[0]?.attrs.attributeName).toBe('Processor type')
    expect(a.hits[0]?.start).toBe(4)
  })
})

describe('inclusion candidates', () => {
  const cases: [string, string][] = [
    ['Selling as I upgraded to a RTX 5080', 'mention'],
    ['Only selling because I am waiting for my RTX 5080', 'mention'],
    ['Performance equivalent to RTX 5080 in most games', 'mention'],
    ['Swap for RTX 5080 considered', 'mention'],
    ['I buy RTX 5080 cards for cash', 'mention'],
    ['Comes without the RTX 5080', 'not_included'],
    ['RTX 5080 not included', 'not_included'],
    ['RTX 5080 (not included, sold separately)', 'not_included'],
    ['RTX 5080 box only', 'not_included'],
    ['RTX 5080-level performance', 'mention'],
    ['Upgraded to a 4090 so selling my RTX 5080', 'offered'],
    ['GPU: RTX 5080 16GB Founders', 'offered'],
  ]
  it.each(cases)('%s → %s', (text, expected) => {
    const a = run('x', text)
    const hit = a.hits.find((h) => h.partType === 'gpu' && h.reading.includes('5080'))
    expect(hit?.inclusion).toBe(expected)
  })

  it('reads the anchored window only', () => {
    expect(inclusionOf('upgraded to ', '')).toBe('mention')
    expect(inclusionOf('upgraded to a new case, and my ', '')).toBe('offered')
    expect(inclusionOf('', ' not included')).toBe('not_included')
  })
})

describe('listing kind', () => {
  const kindOf = (title: string, description: string | null = null) => {
    const a = run(title, description)
    return a.kind ?? `gap:${a.kindGap}`
  }
  it('settles what the title settles', () => {
    expect(kindOf('Lenovo Legion Gaming PC – RTX 3070, i7-10700K, 16GB RAM')).toBe('pc')
    expect(kindOf('Lenovo Legion 5 Pro RTX 3070')).toBe('laptop')
    expect(kindOf('ASUS gaming laptop RTX 4060')).toBe('laptop')
    expect(kindOf('WANTED RTX 3080')).toBe('wanted_or_swap')
    expect(kindOf('Gaming PC', 'I buy all gaming pcs, cash paid')).toBe('wanted_or_swap')
    expect(kindOf('Gaming chair')).toBe('not_a_pc')
    expect(kindOf('Dell OptiPlex 3090')).toBe('pc')
    expect(kindOf('Turtle Beach Recon 50 Gaming Headset – PC/PS/Xbox')).toBe('gap:conflict')
    expect(kindOf('RTX 3080 Founders')).toBe('gap:no_signal')
  })

  it('reads the wanted-advert pattern on the first 400 description characters only', () => {
    const late = `${'Great PC. '.repeat(45)}I buy all gaming pcs`
    expect(kindOf('Gaming PC', late)).toBe('pc')
  })

  it('records box-only wording as a signal', () => {
    const a = run('RTX 4090 box only', null)
    expect(a.signals.map((s) => s.signal)).toContain('box_only')
  })

  it('decides from signals alone', () => {
    const s = (signal: Signal['signal']): Signal => ({
      signal,
      source: 'title',
      quote: 'x',
      start: 0,
      end: 1,
      ruleId: 'r',
    })
    expect(decideKind([s('laptop'), s('pc')])).toEqual({ kind: null, kindGap: 'conflict' })
    expect(decideKind([s('laptop_family'), s('cpu_or_pc')])).toEqual({ kind: 'pc', kindGap: null })
    expect(decideKind([])).toEqual({ kind: null, kindGap: 'no_signal' })
  })
})

describe('gaps and keys', () => {
  it('lists open core parts of a PC and none of a wanted advert', () => {
    const a = run('Gaming PC RTX 3070', 'Upgraded to a Ryzen 5 5600X\nwithout RAM')
    for (const h of a.hits) if (h.partType === 'gpu') h.catalogueId = 'gpu:nvidia:rtx-3070:8gb'
    expect(partGaps(a.hits, 'pc')).toEqual([
      { partType: 'cpu', reason: 'mention_only' },
      { partType: 'ram_size', reason: 'not_stated' },
      { partType: 'storage_size', reason: 'not_stated' },
    ])
    expect(partGaps(a.hits, 'wanted_or_swap')).toEqual([])
  })

  it('reports conflicting and unresolved GPUs', () => {
    const a = run('Gaming PC RTX 3070', 'GPU: GTX 1080')
    expect(partGaps(a.hits, 'pc')[0]).toEqual({ partType: 'gpu', reason: 'conflict' })
    const b = run('Gaming PC GTX 970', 'GPU: NVIDIA GTX 970 4GB')
    expect(partGaps(b.hits, 'pc')[0]).toEqual({ partType: 'gpu', reason: 'unresolved' })
    expect(gpuKey('RTX 4080 S')).toBe('4080super')
    expect(gpuKey('rtx 3060ti')).toBe('3060ti')
  })

  it('keeps a catalogue match only when its model numbers are quoted', () => {
    expect(numbersAgree('GTX 1070', 'GTX 970')).toBe(false)
    expect(numbersAgree('RTX 3090 Ti', 'RTX 3090 Ti')).toBe(true)
    expect(numbersAgree('Core i5 (10th gen)', 'i5 10600KF')).toBe(true)
    expect(numbersAgree('AMD Ryzen 7 2000 series', 'Ryzen 7 2700X')).toBe(true)
    expect(numbersAgree('AMD Ryzen 7 2000 series', 'Ryzen 7 3700X')).toBe(false)
  })

  it('derives the rule version and a replay-stable event key', () => {
    expect(ruleVersion(pack.partPatternsSource.sha256)).toMatch(/^r\d+\.[0-9a-f]{8}$/)
    const runs = [
      { listingId: 'b', evidenceHash: '2' },
      { listingId: 'a', evidenceHash: '1' },
    ]
    expect(ranKey('r1.00000000', runs, 0)).toBe(ranKey('r1.00000000', [...runs].reverse(), 0))
    expect(ranKey('r1.00000000', runs, 0)).not.toBe(
      ranKey('r1.00000000', [{ listingId: 'a', evidenceHash: '3' }, runs[0] as never], 0),
    )
  })
})
