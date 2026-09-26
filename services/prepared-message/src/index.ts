// Public API of the prepared-message module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/prepared-message' only, never from its internals.
//
// There is no send path: `build` returns text for the user to copy. Nabvy never contacts sellers
// (docs/design/modules/prepared-message.md), so this module has no transport, no channel and no
// recipient, and writes nothing.
import {
  PREPARED_MESSAGE_BATCH_SIZE,
  PREPARED_MESSAGE_MAX_QUOTE_CHARS,
} from '@nabvy/config/modules/prepared-message'
import {
  type PreparedMessage,
  PreparedMessageBuildInput,
  type PreparedMessageTemplate,
} from '@nabvy/contracts/modules/prepared-message'
import type { Queryable } from '@nabvy/db'
import { isOn } from '@nabvy/switches'
import { compose, PACK_ID, showQuote, TEMPLATES } from './domain'
import { selectVersions } from './repo'

export {
  events,
  module,
  PreparedMessage,
  PreparedMessageBuildInput,
  PreparedMessageChecklistItem,
  PreparedMessageItemKind,
  PreparedMessageTemplate,
} from '@nabvy/contracts/modules/prepared-message'
export { compose, showQuote } from './domain'

const template: PreparedMessageTemplate = (() => {
  const found = TEMPLATES.find((t) => t.packId === PACK_ID)
  if (!found) throw new Error(`prepared-message: no template for pack ${PACK_ID}`)
  return found
})()

/**
 * The prepared message and checklist of each listing's latest assessed version, keyed by
 * listing ID; listings with nothing to ask are left out. Empty unless the module's switch is
 * `on` (shadow shows users nothing, rule 11). Quotes show only while quote-redaction is `on`,
 * each through its `redact()`; otherwise the checklist carries no quote and the asks still show.
 * Reads listing-assessment's internal views, so run it as nabvy_pipeline (`withPipeline`).
 */
export async function buildMany(
  q: Queryable,
  input: PreparedMessageBuildInput,
): Promise<Map<string, PreparedMessage>> {
  const { listingIds } = PreparedMessageBuildInput.parse(input)
  const out = new Map<string, PreparedMessage>()
  if (!(await isOn(q, 'prepared-message'))) return out
  const quotesShown = await isOn(q, 'quote-redaction')
  const ids = [...new Set(listingIds)]
  for (let i = 0; i < ids.length; i += PREPARED_MESSAGE_BATCH_SIZE) {
    for (const version of await selectVersions(q, ids.slice(i, i + PREPARED_MESSAGE_BATCH_SIZE))) {
      const message = compose(
        {
          listingId: version.listingId,
          evidenceHash: version.evidenceHash,
          unknowns: version.unknowns,
          confirmed: version.confirmed.map((p) => ({
            partType: p.partType,
            quote: quotesShown ? showQuote(p.quote, PREPARED_MESSAGE_MAX_QUOTE_CHARS) : null,
          })),
          quotesShown,
        },
        template,
      )
      if (message) out.set(version.listingId, message)
    }
  }
  return out
}

/** One listing's prepared message, or null (switch not on, not assessed, or nothing to ask). */
export async function build(q: Queryable, listingId: string): Promise<PreparedMessage | null> {
  return (await buildMany(q, { listingIds: [listingId] })).get(listingId) ?? null
}
