// Event transport (task 0.9): the thin-event publisher and the handler wrapper every module uses.
// See README.md.
export {
  type DeadLetterSink,
  defineHandler,
  type EventHandler,
  type HandlerContext,
  type HandlerDeps,
  type HandlerSpec,
  RetryableEventError,
} from './handler'
export { createMemoryPublisher, type MemoryPublisher } from './memory'
export { byTask, emit, type Publisher } from './publisher'
export {
  createEventRegistry,
  dispatchEvent,
  registerEvent,
  type EventRegistry,
  type RegistryEntry,
} from './registry'
export { createTriggerPublisher, type TriggerClient, type TriggerItem } from './trigger'
