import { z } from 'zod'

// The hand-labelled `expected.json` of a listing fixture (docs/fixtures.md). `facts` stays an open
// object until the pack's facts type lands in packages/contracts; then it is parsed with that.

export const valuationStates = ['valued', 'ask_based', 'unvalued'] as const

export const listingExpectedSchema = z.strictObject({
  facts: z.record(z.string(), z.unknown()),
  productKey: z.string().min(1).nullable(),
  components: z.array(z.record(z.string(), z.unknown())).optional(),
  riskFlags: z.array(z.string().min(1)),
  valuationState: z.enum(valuationStates),
  handValueMinor: z.int().nonnegative().nullable().optional(),
  gateExpected: z.enum(['in', 'out']),
  notes: z.string().optional(),
})

export type ListingExpected = z.infer<typeof listingExpectedSchema>
