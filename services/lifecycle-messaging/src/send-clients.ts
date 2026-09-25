// The send seam: PostHog Workflows and Resend accounts do not exist yet (this session's brief),
// so there is nothing to call. These interfaces are what a later session wires to the real APIs;
// `InMemory*` implementations are the only ones today, recording what they would have sent for
// tests and fixtures to assert against (the same pattern services/marketing-consent's
// SuppressionSyncClient uses).
import type { LifecycleMessagingProgramme } from '@nabvy/contracts/modules/lifecycle-messaging'
import type { RenderedMessage } from './domain/copy'

export interface LifecycleMessage extends RenderedMessage {
  userId: string
  email: string
  programme: LifecycleMessagingProgramme
  step: string
}

/** Sends the actual email (docs/marketing.md: "transactional email goes through Resend"). */
export interface ResendClient {
  send(message: LifecycleMessage): Promise<{ id: string }>
}

export class InMemoryResendClient implements ResendClient {
  readonly sent: LifecycleMessage[] = []

  async send(message: LifecycleMessage): Promise<{ id: string }> {
    this.sent.push(message)
    return { id: `mem_${this.sent.length}` }
  }
}

/**
 * Keeps PostHog Workflows' own goal-event tracking in step with what this module actually sent
 * (docs/marketing.md: "Behaviour-triggered messaging runs on PostHog Workflows"; module card:
 * "run behaviour-triggered messages through PostHog Workflows and Resend"). This module owns the
 * trigger/wait/exit decision itself (`src/domain/decide.ts`) because PostHog Workflows cannot be
 * configured or tested without an account; once one exists, a real implementation of this
 * interface reports each step's run to it (services/lifecycle-messaging/README.md, "Decisions").
 */
export interface PostHogWorkflowsClient {
  recordStepRun(input: {
    userId: string
    programme: LifecycleMessagingProgramme
    step: string
    at: string
  }): Promise<void>
}

export class InMemoryPostHogWorkflowsClient implements PostHogWorkflowsClient {
  readonly calls: Array<{
    userId: string
    programme: LifecycleMessagingProgramme
    step: string
    at: string
  }> = []

  async recordStepRun(input: {
    userId: string
    programme: LifecycleMessagingProgramme
    step: string
    at: string
  }): Promise<void> {
    this.calls.push(input)
  }
}

/**
 * Resolves a user's send address. No module this card depends on (`switches`, `product-events`,
 * `marketing-consent`, `account`) exposes an email -- the same gap
 * services/marketing-consent/README.md already records ("this module has no way to resolve a
 * user's email from userId alone") -- so a user with no resolvable email is skipped rather than
 * guessed at (docs/questions/lifecycle-messaging.md). No row is written for a skipped send, so it
 * is retried on the next run once a real resolver exists.
 */
export interface EmailResolver {
  resolve(userId: string): Promise<string | null>
}

export class InMemoryEmailResolver implements EmailResolver {
  constructor(private readonly emails: Readonly<Record<string, string>> = {}) {}

  async resolve(userId: string): Promise<string | null> {
    return this.emails[userId] ?? null
  }
}
