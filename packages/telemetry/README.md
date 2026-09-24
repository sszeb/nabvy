# @nabvy/telemetry

Analytics and observability clients (task 0.10): PostHog behavioural analytics and Langfuse
model tracing, wrapped so every caller gets the same consent gate, property allow-list and
no-keys-yet behaviour (`docs/analytics.md`, `docs/design/analytics-growth.md` sections 5-6).
`services/product-events` (the `product_events` table and `track()`, not yet built) is the
system of record for first-party events; this package only reaches the two third parties.

## PostHog

```ts
import { createPostHogServer } from '@nabvy/telemetry'

const posthog = createPostHogServer() // reads the `posthog` group of @nabvy/config
await posthog.capture(userId, hasConsent, { event: 'alert_delivered', properties: { ... } })
await posthog.isFeatureEnabled('pricing-page-v2', userId, hasConsent)
await posthog.shutdown()
```

- `capture()` checks `hasConsent` before doing anything, and validates the event against
  `ProductEventsEvent` (`packages/contracts/src/modules/product-events.ts`) even though the
  caller's own type already matches it: a JS caller, or one that built the object by hand, does
  not get to skip the allow-list.
- `isFeatureEnabled()` also takes `hasConsent`: no `personalApiKey` is configured (no such secret
  exists yet), so a check reaches PostHog's remote `/flags` endpoint with `userId` rather than
  evaluating locally, and that call needs the same consent as a capture.
- `PostHogClientProvider` (`src/posthog/client.tsx`) loads `posthog-js` only once both a project
  key and consent are present, through the app's own `/ingest` rewrite (never straight to
  `eu.i.posthog.com`, so ad blockers do not drop events), with `session_recording.maskAllInputs`
  on. The key is read server-side and passed down as a prop; no `NEXT_PUBLIC_` variable exists
  for it. `captureProductEvent(client, event)` wraps a `usePostHog()` client with the same
  `ProductEventsEvent` allow-list `capture()` uses server-side, so a browser caller cannot reach
  the raw `posthog-js` client and send a property outside it either.

## Langfuse

```ts
import { registerTracing, traceStage, createLangfusePromptClient } from '@nabvy/telemetry'

const tracing = registerTracing() // reads the `langfuse` group; call once, at process start
const span = traceStage('extraction', { listingId, packId, tier: 'default' })
// ...
span.end()

const prompts = createLangfusePromptClient()
const prompt = await prompts.getPrompt('gpu-pc-extraction', 'production')
```

- `registerTracing()` sets up an `@opentelemetry/sdk-node` `NodeSDK` with one
  `LangfuseSpanProcessor` (`@langfuse/otel`), carrying a mask function and a sampler.
- **Masking** (`src/langfuse/masking.ts`) strips seller-shaped keys (`seller*`, `contact*`,
  `profile*`, `photo*`) and redacts emails and UK phone numbers in every remaining string, before
  a span leaves Nabvy. "Actor data kept in full" (`docs/decisions.md`) covers Nabvy's own
  storage; sending listing text or seller fields to a third party is a different act, so the
  conservative default applies (design section 5): production traces carry ids and structured
  facts, and the full listing stays in Nabvy, opened through the trace id. The Langfuse SDK hands
  the mask function a JSON-encoded string for `input`, `output` and non-object `metadata`
  attributes (each flattened `metadata.<key>` sub-attribute is not covered by the SDK's own
  masking hook, so `traceStage` carries only thin identifiers there, never anything sensitive).
- **Sampling** (`src/langfuse/sampling.ts`) always exports a model call (a `generation` or
  `embedding` observation, or a span carrying `gen_ai.*`/`ai.*` attributes from the Vercel AI SDK
  or another LLM instrumentor) and samples every other span at `LANGFUSE_SAMPLE_RATE`
  (`@nabvy/config`, default `1`), so a busy pipeline stage does not burn through the Langfuse
  free tier while every model call is still traced and costed.
- `traceStage()` carries only identifiers (`listingId`/`scanId`, `packId`, `tier`, and from task
  1.5, `areaId`/`runId`), the same "thin payload" rule as an event
  (`packages/contracts/src/core/events.ts`). It works even when `registerTracing()` was never
  called: OpenTelemetry's default global tracer is a no-op, so a span object is still returned,
  and nothing is exported.
- `createLangfusePromptClient()` wraps `@langfuse/client`'s `LangfuseClient.prompt.get()`
  (built-in `cacheTtlSeconds` caching), for the pack instruction blocks and recognition/
  explanation prompts Langfuse holds as versioned, labelled prompts (`docs/analytics.md:46`).

## No keys yet

Every export above does nothing until its keys exist (`docs/secrets.md`): `createPostHogServer()`,
`registerTracing()` and `createLangfusePromptClient()` each `safeLoadEnv` their group
(`@nabvy/config`) rather than the throwing `loadEnv`, and return a no-op implementation on a
missing key, so no client is built and no network call is made. `PostHogClientProvider` renders
its children unchanged until `posthogKey` is set. `@nabvy/config` marks `POSTHOG_*` and
`LANGFUSE_*` `required()`, which is correct for every caller that needs them to run; this package
is the one place that must run with reduced function instead, so it uses the non-throwing
`safeLoadEnv` (`packages/config/README.md`, "Decisions"). Wiring a production alert for a missing
key in production waits for `ops-alerts` (not yet built); `docs/questions.md` records it.

## Decisions

- **The property allow-list lives in `@nabvy/contracts`, not here.**
  `ProductEventsEvent` (`packages/contracts/src/modules/product-events.ts`) is a discriminated
  union on `event`, one `z.strictObject` of allowed properties per event name, derived from the
  table in `docs/analytics.md` (lines 17-30). An unknown key -- `email`, `postcode`, a free-text
  `note` -- is rejected for every event because no event declares it: allow-listing keys, not
  denying known-bad ones. `services/product-events` (task not yet started) owns the table and
  `track()`; this file is scoped to only what 0.10 needs, and is the natural home for that
  module's own contracts when it is built.
- **`safeLoadEnv` added to `@nabvy/config`**, rather than duplicating a try/catch around
  `loadEnv` in every wrapper here: `loadEnv` keeps failing fast for every other caller (`packages/config/README.md`).
- **`@opentelemetry/sdk-node`**, not the lighter `@opentelemetry/sdk-trace-node` the
  `@langfuse/otel` quickstart shows, per the design's dependency list (section 6): the pipeline
  will eventually want auto-instrumentation for outbound HTTP the SDK provides and the trace-only
  package does not.
- **`react` is a peer dependency.** `PostHogClientProvider` is a component for `apps/web` to
  render from a server component with its own PostHog key; this package does not bundle a copy
  of React.
- **Dependencies and licences** (`CLAUDE.md`, "No new dependencies"): `posthog-js` and
  `posthog-node` (MIT); `@langfuse/otel`, `@langfuse/tracing` and `@langfuse/client` (MIT);
  `@opentelemetry/api` and `@opentelemetry/sdk-node` (Apache-2.0). Each is the tool
  `docs/analytics.md` and the design name for PostHog and Langfuse; checked against the
  installed package's own `license` field, not the vendor's marketing page.

## Not in this task

Wiring `track()` and `services/product-events` (the `product_events` table, the consent read
from `v_profiles`), the `area` PostHog group, revenue events, the profit dashboard and the
experiment registry (design section 6, task 4.6a), and `ops-metrics`/`pricing-console`'s use of
Langfuse cost as a cross-check are later tasks. `traceStage`'s `areaId`/`runId` arrive with 1.5.
