// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
export { type CopyContext, type RenderedMessage, renderCopy } from './copy'
export { decideStep, type StepDecision, type StepEvalContext } from './decide'
export {
  categoryOf,
  isMarketingStep,
  PROGRAMMES,
  type ProgrammeDefinition,
  type ProgrammeStep,
  programmeById,
} from './programmes'
