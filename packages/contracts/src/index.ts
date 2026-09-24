// Shared core contracts. Per-module contracts live in src/modules/<module>.ts and are imported
// from their own subpath, `@nabvy/contracts/modules/<module>`; see README.md.
export { DeliveryMethod, ListedAtPrecision, Source } from './core/enums'
export {
  batchKey,
  createEvent,
  defineEvents,
  type Envelope,
  type EventDefinitions,
  EventEnvelope,
  type EventOf,
  type EventPayload,
  type EventRegistry,
  EventType,
  EventVersion,
  type EventVersions,
  IdempotencyKey,
  latestVersion,
  listingKey,
  ModuleName,
  type ParseEventResult,
  parseEvent,
  safeParseEvent,
  taskIdFor,
} from './core/events'
export { brandedId, Uuid, UuidV7, uuidv7 } from './core/ids'
export { ListingStub, PriceKind } from './core/listing-stub'
export {
  AmountMinor,
  addMoney,
  Currency,
  CurrencyMismatchError,
  compareMoney,
  Money,
  money,
  moneyIn,
  subtractMoney,
} from './core/money'
export { AppError, ErrorCode, err, ok, type Result } from './core/result'
export {
  IsoTimestamp,
  isoNow,
  secondsBetween,
  stamp,
  TStampName,
  TStamps,
} from './core/time'
export { DeadLetter, DeliveryAttempt, HandledEvent, TransportErrorCode } from './core/transport'
