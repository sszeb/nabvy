// What the rules leave open (pure): per core part of a PC or laptop, whether it was not stated,
// only mentioned, not named by the catalogue, or named twice differently. The model pass
// (`parts-ai`) runs only on these gaps (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:245-246).

import type {
  PartsRulesKind,
  PartsRulesPartGap,
  PartsRulesPartType,
} from '@nabvy/contracts/modules/parts-rules'
import { cpuKey, gpuKey, type Hit } from './rules'

/** The parts every PC or laptop has, so a missing one is a gap. */
export const CORE_PARTS: PartsRulesPartType[] = ['gpu', 'cpu', 'ram_size', 'storage_size']

/** Kinds whose parts are not asked for: a wanted advert or something that is not a computer. */
const NO_PARTS: (PartsRulesKind | null)[] = ['wanted_or_swap', 'not_a_pc']

export function partGaps(hits: Hit[], kind: PartsRulesKind | null): PartsRulesPartGap[] {
  if (NO_PARTS.includes(kind)) return []
  const gaps: PartsRulesPartGap[] = []
  for (const partType of CORE_PARTS) {
    const all = hits.filter((h) => h.partType === partType)
    const offered = all.filter((h) => h.inclusion === 'offered')
    if (all.length === 0) {
      gaps.push({ partType, reason: 'not_stated' })
    } else if (offered.length === 0) {
      gaps.push({ partType, reason: 'mention_only' })
    } else if (partType === 'gpu' || partType === 'cpu') {
      const key = partType === 'gpu' ? gpuKey : cpuKey
      const keys = new Set(offered.map((h) => h.catalogueId ?? key(h.reading)))
      const ids = new Set(offered.map((h) => h.catalogueId).filter((id) => id !== null))
      // Two hits that name the same model, one resolved and one not, are one part.
      const models = new Set(offered.map((h) => key(h.reading)))
      if (ids.size > 1 || (models.size > 1 && keys.size > 1)) {
        gaps.push({ partType, reason: 'conflict' })
      } else if (ids.size === 0) {
        gaps.push({ partType, reason: 'unresolved' })
      }
    }
  }
  return gaps
}
