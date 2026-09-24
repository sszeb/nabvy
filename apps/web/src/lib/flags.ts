/**
 * UI feature flags. Code constants until task 4.6a reads flags server-side; each flag is off by
 * default and only an owner decision turns it on.
 */
export const flags = {
  /**
   * Show listing photos. Off: every listing shows a neutral placeholder. Waits for the owner's
   * decision on whether Facebook photo URLs may be displayed (docs/questions.md).
   */
  listingPhotos: false,
} as const

export type FlagName = keyof typeof flags
