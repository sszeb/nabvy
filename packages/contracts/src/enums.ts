import { z } from 'zod'

// Enumerations from docs/contracts.md. Task 0.2 adds the rest here.

export const RiskFlag = z.enum([
  'mining',
  'untested',
  'stock_photo',
  'deposit_request',
  'new_seller',
  'reused_photos',
  'price_far_below_floor',
  'parts_only',
  'wanted_post',
  'empty_box',
])
export type RiskFlag = z.infer<typeof RiskFlag>

// Flags computed from seller keys. The brief keeps them out of every public table and every
// public score (docs/decisions.md, Precedence, "Seller-derived flags").
export const sellerDerivedRiskFlags = ['new_seller', 'reused_photos'] as const satisfies RiskFlag[]
