import { describe, expect, it } from 'vitest'
import { InMemoryWaitlistSender } from '../src/sender'

const entry = {
  id: '00000000-0000-7000-8000-000000000001',
  email: 'sam@example.com',
  postcode: null,
  wantedProducts: [],
  utm: {},
  createdAt: '2026-09-24T00:00:00.000Z',
}

// No sender sends real email yet (docs/questions.md, "waitlist: sending interface"): this
// implementation only records what it was asked to send.
describe('InMemoryWaitlistSender', () => {
  it('records every entry it is asked to send, in order', async () => {
    const sender = new InMemoryWaitlistSender()
    await sender.send(entry)
    await sender.send({ ...entry, email: 'other@example.com' })
    expect(sender.sent.map((e) => e.email)).toEqual(['sam@example.com', 'other@example.com'])
  })
})
