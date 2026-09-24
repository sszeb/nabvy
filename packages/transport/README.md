# @nabvy/transport

Event transport (task 0.9): the thin-event publisher and the handler wrapper every module uses
(`docs/engineering.md`, "Events and tasks"; `docs/contracts.md`, "Events"). The envelope, event
registries, keys and stamps are in `@nabvy/contracts`; the delivery shapes (`DeliveryAttempt`,
`DeadLetter`, `HandledEvent`, `TransportErrorCode`) are in its `core/transport.ts`; the retry
policy (`eventRetry`) and batch limit are in `@nabvy/config`.

## Publishing

```ts
import { emit } from '@nabvy/transport'
import { events } from '@nabvy/contracts/modules/listing-ingest'

await emit(publisher, events, 'listing-ingest.first-seen', { listingIds }, {
  key: await batchKey('listing-ingest.first-seen', listings.map(listingKey)),
})
```

`Publisher` has two implementations:

- `createTriggerPublisher(client)`: one Trigger.dev batch trigger per task (`listing.new` →
  task `listing-new`), split at 500, with the envelope `key` as the idempotency key. `client` is
  a two-line adapter over the SDK's `tasks.batchTrigger`, so this package needs neither the SDK
  nor credentials. The adapter must create keys with
  `idempotencyKeys.create(key, { scope: 'global' })`: the SDK scopes a key to the calling run by
  default, which would let a retried handler start its consumer twice.
- `createMemoryPublisher()`: for tests and local runs. It drops a second publish of the same key
  to the same task, as Trigger.dev does, and keeps it in `duplicates` for assertions.

## Handling

```ts
export const onFirstSeen = defineHandler({
  consumer: 'details-selector',
  registry: listingIngestEvents,          // the producer's registry
  type: 'listing-ingest.first-seen',
  stamp: 't2Candidate',                   // omit outside the T0–T7 chain
  async handle(event, ctx) {
    // load by ID, upsert keyed on source + sourceListingId + contentHash,
    // stamps = ctx.stamp(stamps), ctx.emit(createEvent(...)), return ok(undefined)
  },
})
```

`run(raw, attempt, deps)` does, in order:

1. A malformed envelope returns `rejected`: with no valid envelope there is nothing to key or
   re-emit. A valid envelope of another type, or with a bad payload, is dead-lettered at once
   (`transport.invalid_event`), since retrying cannot fix it.
2. The handler gets one hop time `ctx.at` for the whole batch. `ctx.stamp()` sets its declared
   T-stamp to that time, keeping an earlier value, so a replay never moves a stamp.
3. Events queued with `ctx.emit()` are published only after the handler returns `ok`, so a failed
   attempt publishes nothing. Their keys must come from the input, so a retry publishes the same
   keys and the transport drops the repeats.
4. A failure (an `err` result, a throw as `transport.handler_threw`, or a publish failure as
   `transport.publish_failed`) throws `RetryableEventError` before the last attempt, so the runtime
   retries it (`eventRetry`: 3 attempts, 5 s then 30 s). On the last attempt it goes to the
   `DeadLetterSink` as a `DeadLetter` and the event the sink returns (`incidents.dead-lettered`)
   is published.

**Idempotency lives in the handler.** The wrapper does not keep a ledger of handled keys: the
transport's idempotency keys stop duplicate starts, and the handler's upserts on
`source + sourceListingId + contentHash` make a redelivery write nothing
(`docs/design/modules/_rules.md`, rule 8). The fixture test runs a 120-listing batch twice and
checks the second run writes nothing, moves no stamp and publishes nothing new.

## Wiring (task 1.2 onwards)

A Trigger.dev task file stays thin:

```ts
export const listingIngestFirstSeen = task({
  id: 'listing-ingest-first-seen',
  retry: eventRetry,
  run: (payload, { ctx }) =>
    onFirstSeen.run(
      payload,
      { attempt: ctx.attempt.number, maxAttempts: eventRetry.maxAttempts, firstAttemptAt }, // run start, from ctx.run
      { publisher, deadLetters: { record: (input) => withPipeline((db) => incidents.record(db, input)) } },
    ),
})
```

`incidents.record(db, input)` (PR #19) takes the same shape as `DeadLetter` and returns
`{ incident, event }`, so it satisfies `DeadLetterSink` once the task closes over the database.
Two handlers of the same event in different modules are two tasks; task ids for fan-out are
settled with the first such pair (`docs/questions.md`, 0.9).
