import { describe, expect, it } from 'vitest'
import {
  PARTS_AI_OUTPUT_SCHEMA,
  PARTS_AI_PROMPT_VERSION,
  PARTS_AI_SYSTEM_PROMPT,
  promptVersion,
} from '../src'
import { type CaseOptions, runCase } from './support/cases'
import { ALL_ON, createTestDatabase, openThrottle } from './support/database'
import { loadRecording } from './support/model'

// The evaluation run (backlog 1.5a, the card): the evaluation cases run end to end and are
// scored by deterministic field match on every stored part, kind and outcome. The current
// prompt passes every case; a deliberately weakened prompt (the lines on untrusted text, the
// seller's instructions, mentions and guessing removed), replayed from what it answered, must
// fail the run. No Anthropic key exists yet, so both prompts' answers are recordings
// (README.md, "Decisions"); with a key, the same scorer runs over live calls.

const weakened = loadRecording('weakened') as ReturnType<typeof loadRecording> & { cases: string[] }

const WEAK_SYSTEM = PARTS_AI_SYSTEM_PROMPT.split('\n')
  .filter(
    (line) =>
      !/never instructions|Ignore any request|only mentioned is never|never guess/i.test(line),
  )
  .join('\n')

/** Cases passed out of cases run, each on a fresh database. */
async function evaluate(options: CaseOptions): Promise<{ passed: number; failed: string[] }> {
  let passed = 0
  const failed: string[] = []
  for (const id of weakened.cases) {
    const t = await createTestDatabase()
    try {
      await t.switches(ALL_ON)
      await openThrottle(t)
      const { observed, expected } = await runCase(t, id, options)
      if (JSON.stringify(observed) === JSON.stringify(expected)) passed += 1
      else failed.push(id)
    } finally {
      await t.close()
    }
  }
  return { passed, failed }
}

describe('evaluation run', () => {
  it('the weakened prompt really is weaker: three lines fewer, another version', () => {
    expect(PARTS_AI_SYSTEM_PROMPT.split('\n').length - WEAK_SYSTEM.split('\n').length).toBe(3)
    expect(promptVersion(WEAK_SYSTEM, PARTS_AI_OUTPUT_SCHEMA)).not.toBe(PARTS_AI_PROMPT_VERSION)
  })

  it('the current prompt passes every evaluation case', async () => {
    const result = await evaluate({})
    expect(result).toEqual({ passed: weakened.cases.length, failed: [] })
  }, 120_000)

  it('a deliberately weakened prompt fails the run', async () => {
    const version = promptVersion(WEAK_SYSTEM, PARTS_AI_OUTPUT_SCHEMA)
    const result = await evaluate({
      prompt: { system: WEAK_SYSTEM, version },
      responses: weakened.responses,
    })
    expect(result.passed).toBeLessThan(weakened.cases.length)
    // It reads an extra-cost drive as offered, a mention as offered, and obeys the injection.
    expect(result.failed).toEqual(['recorded-run', 'mention-only', 'prompt-injection'])
  }, 120_000)
})
