# trigger

Trigger.dev task definitions, thin wrappers around service functions (`docs/engineering.md`,
"Events and tasks"). The first task arrives with 1.2. The owner chose Trigger.dev as the pipeline
runtime (`docs/questions.md`); no Trigger.dev account exists yet, so nothing here runs live.

An event task parses nothing itself: it calls the consuming module's handler, wrapped with
`defineHandler` from `@nabvy/transport`, passing the attempt number and the publisher and
dead-letter sink, with `retry: eventRetry` from `@nabvy/config`. The wrapper does validation,
stamps, retries and dead-lettering (`packages/transport/README.md`, "Wiring").
