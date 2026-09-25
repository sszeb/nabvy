import type { CopyAdvertBasis, CopyAdvertRuleConfig } from '@nabvy/contracts/modules/copy-advert'

type DescStatus = 'full_verified' | 'partial' | 'missing' | null

/** Whether one side of a pair lacks confirmable description evidence (docs 4.1, 4.4 S4). */
export function lacksEvidence(status: DescStatus): boolean {
  return status !== 'full_verified'
}

/**
 * S3, confirm by description: for a pair sharing `advert_fp`, both sides `full_verified`
 * (docs/design/drafts/copy-advert.md 4.4). Equal `desc_fp` is `exact_text`, unless either
 * description is short and the shared title is not long enough, in which case it splits as a
 * `lookalike`. Different descriptions need both sides long enough, then a trigram similarity of
 * at least `nearText`.
 */
export function confirmBasis(input: {
  titleNormLen: number
  descFpA: string
  descFpB: string
  descLenA: number
  descLenB: number
  similarity: number
  rules: Pick<CopyAdvertRuleConfig, 'descMinChars' | 'titleMinChars' | 'nearText'>
}): Extract<CopyAdvertBasis, 'exact_text' | 'near_text' | 'lookalike'> {
  const { rules } = input
  const eitherShort = input.descLenA < rules.descMinChars || input.descLenB < rules.descMinChars
  const longTitle = input.titleNormLen >= rules.titleMinChars
  if (input.descFpA === input.descFpB) {
    return eitherShort && !longTitle ? 'lookalike' : 'exact_text'
  }
  if (eitherShort) return 'lookalike'
  return input.similarity >= rules.nearText ? 'near_text' : 'lookalike'
}

/**
 * S5, text copies (internal only): a pair with a different `advert_fp` (different title or price)
 * but matching description evidence, both sides long enough (docs 4.4).
 */
export function isTextCopy(input: {
  descFpA: string
  descFpB: string
  descLenA: number
  descLenB: number
  similarity: number
  rules: Pick<CopyAdvertRuleConfig, 'descMinChars' | 'textCopy' | 'textCopyMinChars'>
}): boolean {
  const { rules } = input
  if (input.descFpA === input.descFpB) {
    return input.descLenA >= rules.descMinChars && input.descLenB >= rules.descMinChars
  }
  return (
    input.similarity >= rules.textCopy &&
    input.descLenA >= rules.textCopyMinChars &&
    input.descLenB >= rules.textCopyMinChars
  )
}

/**
 * S4, candidates: whether an undescribed side of an S2 pair is worth a paid detail fetch — a
 * long-enough title, and the listing was returned for an active hunt's area (docs 4.4).
 */
export function candidateEligible(
  titleNormLen: number,
  inArea: boolean,
  rules: Pick<CopyAdvertRuleConfig, 'titleMinChars'>,
): boolean {
  return titleNormLen >= rules.titleMinChars && inArea
}
