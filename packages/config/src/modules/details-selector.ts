import { z } from 'zod'

// Thresholds of the details-selector module (rule 14 of docs/design/modules/_rules.md). Each value
// carries a comment with its basis (a cited measurement or rule) and is a starting value until
// this module's fixtures calibrate it.

const detailsSelectorConfig = z.object({
  /**
   * Facebook category IDs counted as "electronics, a container, or a GPU" (card). Facebook's own
   * category is unreliable — this recorded run files desktop-PC listings under "Electronics &
   * computers", "Miscellaneous" (a full PC under "Computer cases"), "Video Games" and "Household",
   * all four under the categoryPath ["Electronics","Computers", ...] (`fixtures/listings/facebook/
   * runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:99,147-149,498,540-542,839,882-884`). A category
   * absent from this list, when known, is excluded; an absent (null) category always counts as in
   * (card: "unknown counts as in"), handled in the domain, not here. No GPU-only category ID has
   * been recorded yet (docs/questions/details-selector.md).
   */
  IN_CATEGORY_IDS: z.array(z.string().min(1)).default([
    '1792291877663080', // Electronics & computers > Computers > Desktop computers
    '895487550471874', // Miscellaneous > Computers > Computer cases
    '686977074745292', // Video Games > Computers > Desktop computers
    '1569171756675761', // Household > Computers > Desktop computers
  ]),
  /**
   * `deliveryTypes` values that count as "offers shipping" (card). No recorded run shows a
   * shipping-offering listing, so this starts empty rather than guessing a value (CLAUDE.md, "no
   * invented numbers"): the `shipped` reason never fires on real data until one is recorded
   * (docs/questions/details-selector.md). The observed values are IN_PERSON, PUBLIC_MEETUP,
   * DOOR_PICKUP and DOOR_DROPOFF, none of which is shipping.
   */
  SHIPPING_DELIVERY_TYPES: z.array(z.string().min(1)).default([]),
  /** Rule 9 (`CLAUDE.md`, "Batches, not items"): handlers take arrays of 100-500 listing IDs. */
  EVENT_BATCH_SIZE: z.int().positive().max(500).default(500),
})

export const config = detailsSelectorConfig.parse({})

export const DETAILS_SELECTOR_IN_CATEGORY_IDS = config.IN_CATEGORY_IDS
export const DETAILS_SELECTOR_SHIPPING_DELIVERY_TYPES = config.SHIPPING_DELIVERY_TYPES
export const DETAILS_SELECTOR_EVENT_BATCH_SIZE = config.EVENT_BATCH_SIZE
