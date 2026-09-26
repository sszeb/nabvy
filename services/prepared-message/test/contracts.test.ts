import {
  events,
  module,
  PreparedMessage,
  PreparedMessageBuildInput,
  PreparedMessageTemplate,
} from '@nabvy/contracts/modules/prepared-message'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../src/domain'

const message = {
  listingId: '0192f0a0-0000-7000-8000-000000000001',
  evidenceHash: 'a'.repeat(64),
  templateVersion: 'placeholder-1',
  text: 'Hello\n- Which graphics card (GPU) does it have?',
  checklist: [{ kind: 'ask', partType: 'gpu', text: 'Which graphics card (GPU) does it have?' }],
  quotesShown: true,
}

describe('prepared-message contracts', () => {
  it('declares its name and publishes no events', () => {
    expect(module).toBe('prepared-message')
    expect(events.module).toBe('prepared-message')
    expect(Object.keys(events.definitions)).toEqual([])
  })

  it('a message parses; unknown keys (a recipient, a seller) are refused', () => {
    expect(PreparedMessage.parse(message)).toEqual(message)
    expect(() => PreparedMessage.parse({ ...message, sellerName: 'Jo' })).toThrow()
    expect(() => PreparedMessage.parse({ ...message, recipient: 'x' })).toThrow()
    expect(() => PreparedMessage.parse({ ...message, checklist: [] })).toThrow()
    expect(() => PreparedMessage.parse({ ...message, text: 'x'.repeat(2001) })).toThrow()
  })

  it('build input is bounded to 500 listing IDs', () => {
    const ids = (n: number) => Array.from({ length: n }, () => message.listingId)
    expect(() => PreparedMessageBuildInput.parse({ listingIds: ids(500) })).not.toThrow()
    expect(() => PreparedMessageBuildInput.parse({ listingIds: ids(501) })).toThrow()
    expect(() => PreparedMessageBuildInput.parse({ listingIds: [] })).toThrow()
  })

  it('a template needs {questions} once, {quote} in the check, and no other placeholder', () => {
    const template = TEMPLATES[0]
    expect(PreparedMessageTemplate.parse(template)).toEqual(template)
    const bad = [
      { message: 'no placeholder' },
      { message: '{questions} {questions}' },
      { message: '{questions} {sellerName}' },
      { check: 'no quote' },
      { check: '{quote} {url}' },
      { questions: { gpu: 'Which {thing}?' } },
      { message: 'broken {questions' },
    ]
    for (const change of bad) {
      expect(
        () => PreparedMessageTemplate.parse({ ...template, ...change }),
        JSON.stringify(change),
      ).toThrow()
    }
  })
})
