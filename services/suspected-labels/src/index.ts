// Public API of the suspected-labels module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/suspected-labels' only, never from its internals.
export { events, module } from '@nabvy/contracts/modules/suspected-labels'
export { evaluateTgtbtSignals, hasSignal, type SignalEvidenceItem } from './domain/index'
export { getCandidatesForListing, getLabelsForListing } from './repo/index'
