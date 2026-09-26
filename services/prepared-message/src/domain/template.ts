import { PreparedMessageTemplate } from '@nabvy/contracts/modules/prepared-message'

// The message template of pack `gpu-pc`. Plain placeholder wording: the words users see are the
// owner's to set (docs/questions/prepared-message.md), and the module's switch stays off until
// they are. The pack format (CategoryPack in @nabvy/contracts/modules/packs) has no message
// template yet, so it lives here, parsed with the contract, until the owner's wording moves into
// the pack (same questions file).
export const TEMPLATES: readonly PreparedMessageTemplate[] = [
  PreparedMessageTemplate.parse({
    packId: 'gpu-pc',
    version: 'placeholder-1',
    message:
      'Hello, is this still available? Before I come to see it, could you tell me:\n{questions}\nThank you.',
    questions: {
      gpu: 'Which graphics card (GPU) does it have?',
      cpu: 'Which processor (CPU) does it have?',
      ram_size: 'How much RAM does it have?',
      storage_size: 'How much storage does it have?',
    },
    check: 'Check in person: the listing says "{quote}"',
  }),
]

/** Every listing is in pack `gpu-pc` today (parts-rules reads that pack alone). */
export const PACK_ID = 'gpu-pc'
