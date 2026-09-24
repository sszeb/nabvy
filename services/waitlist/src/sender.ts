import type { WaitlistEntry } from '@nabvy/contracts/modules/waitlist'

/**
 * Sends a notification about a waitlist entry. No implementation here sends a real email: the
 * owner's email and DNS accounts (Resend, Cloudflare) do not exist yet (`docs/questions.md`,
 * "waitlist: sending interface"). `submit()` does not call a sender today (module card, "Outputs":
 * none beyond its view); this interface exists so a future task can wire one in — a Resend
 * implementation, say — without changing `submit()`'s signature.
 */
export interface WaitlistSender {
  send(entry: WaitlistEntry): Promise<void>
}

/** Records entries instead of sending anything. For tests, and the only implementation until a real one exists. */
export class InMemoryWaitlistSender implements WaitlistSender {
  readonly sent: WaitlistEntry[] = []

  async send(entry: WaitlistEntry): Promise<void> {
    this.sent.push(entry)
  }
}
