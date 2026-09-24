import { z } from 'zod'
import type { Source } from './enums'
import { UuidV7, uuidv7 } from './ids'
import { IsoTimestamp, isoNow } from './time'

/**
 * Thin events (docs/contracts.md, "Events"). The envelope is shared; each module declares its own
 * events and their payload versions in its contract file with `defineEvents`, so no shared
 * registry file exists for parallel branches to conflict over. packages/contracts/README.md
 * explains the conventions.
 */

/** `noun.verb`, lower case, e.g. `listing.new`, `alert.requested`. Transport task: `listing-new`. */
export const EventType = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)
export type EventType = z.infer<typeof EventType>

/** A module's name: its folder under services/, kebab case. */
export const ModuleName = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
export type ModuleName = z.infer<typeof ModuleName>

/** The handler idempotency key; see `listingKey` and `batchKey`. */
export const IdempotencyKey = z.string().min(1).max(512)

/** Payload schema version: starts at 1, and a breaking change adds the next integer. */
export const EventVersion = z.int().min(1)

export const EventEnvelope = z.strictObject({
  id: UuidV7,
  type: EventType,
  v: EventVersion,
  at: IsoTimestamp,
  key: IdempotencyKey,
  payload: z.record(z.string(), z.unknown()),
})
export type EventEnvelope = z.infer<typeof EventEnvelope>

/** Trigger.dev task ID for an event type: `listing.new` → `listing-new` (docs/engineering.md). */
export function taskIdFor(type: string): string {
  return EventType.parse(type).replace('.', '-')
}

type PayloadSchema = z.ZodObject
export type EventVersions = { readonly [version: number]: PayloadSchema }
export type EventDefinitions = { readonly [type: string]: EventVersions }

export interface EventRegistry<
  M extends string = string,
  D extends EventDefinitions = EventDefinitions,
> {
  readonly module: M
  readonly definitions: D
}

type VersionOf<D extends EventDefinitions, T extends keyof D> = keyof D[T] & number

export type Envelope<T extends string, V extends number, P> = {
  id: UuidV7
  type: T
  v: V
  at: IsoTimestamp
  key: string
  payload: P
}

/** Every envelope a registry accepts, as a union discriminated by `type` and `v`. */
export type EventOf<R extends EventRegistry> =
  R extends EventRegistry<string, infer D>
    ? {
        [T in keyof D & string]: {
          [V in VersionOf<D, T>]: Envelope<T, V, z.output<D[T][V]>>
        }[VersionOf<D, T>]
      }[keyof D & string]
    : never

/** The payload of one event version. */
export type EventPayload<
  R extends EventRegistry,
  T extends keyof R['definitions'] & string,
  V extends keyof R['definitions'][T] & number,
> = z.output<R['definitions'][T][V]>

// Leaf kinds a thin payload may carry: identifiers, timestamps, counts, flags, enums, and arrays
// of those. Nested objects are refused because they are how whole records sneak into events.
const THIN_LEAVES = new Set(['string', 'number', 'int', 'boolean', 'enum', 'literal', 'bigint'])
const WRAPPERS = new Set(['optional', 'nullable', 'readonly', 'default'])

function thinProblem(schema: z.ZodType, path: string, inArray = false): string | undefined {
  const def = schema._zod.def as { type: string; innerType?: z.ZodType; element?: z.ZodType }
  if (WRAPPERS.has(def.type) && def.innerType) return thinProblem(def.innerType, path, inArray)
  if (THIN_LEAVES.has(def.type)) return undefined
  if (def.type === 'array' && !inArray && def.element) return thinProblem(def.element, path, true)
  return `${path} is ${def.type}${inArray ? ' inside an array' : ''}`
}

/**
 * Declares a module's events. Throws at import time if a name is malformed, a version is not a
 * positive integer, or a payload is not thin (see above), so a bad contract fails every test.
 */
export function defineEvents<const M extends string, const D extends EventDefinitions>(
  module: M,
  definitions: D,
): EventRegistry<M, D> {
  ModuleName.parse(module)
  for (const [type, versions] of Object.entries(definitions)) {
    if (!EventType.safeParse(type).success) {
      throw new Error(`${module}: event type "${type}" must be noun.verb in lower case`)
    }
    const numbers = Object.keys(versions).map(Number)
    if (numbers.length === 0) throw new Error(`${module}: ${type} declares no versions`)
    for (const version of numbers) {
      if (!EventVersion.safeParse(version).success) {
        throw new Error(`${module}: ${type} version "${version}" must be an integer ≥ 1`)
      }
      const payload = versions[version] as PayloadSchema
      if (payload?._zod.def.type !== 'object') {
        throw new Error(`${module}: ${type} v${version} payload must be a z.object`)
      }
      for (const [field, schema] of Object.entries(payload.shape)) {
        const problem = thinProblem(schema as z.ZodType, field)
        if (problem) {
          throw new Error(
            `${module}: ${type} v${version} payload is not thin (${problem}); events carry identifiers and timestamps only`,
          )
        }
      }
    }
  }
  return Object.freeze({ module, definitions })
}

/** The highest version declared for an event type: producers emit this one. */
export function latestVersion<R extends EventRegistry, T extends keyof R['definitions'] & string>(
  registry: R,
  type: T,
): VersionOf<R['definitions'], T> {
  const versions = registry.definitions[type]
  if (!versions) throw new Error(`${registry.module}: unknown event type "${type}"`)
  return Math.max(...Object.keys(versions).map(Number)) as VersionOf<R['definitions'], T>
}

/** Builds and validates an envelope. `id` and `at` default to a fresh UUID v7 and now. */
export function createEvent<
  R extends EventRegistry,
  T extends keyof R['definitions'] & string,
  V extends keyof R['definitions'][T] & number,
>(
  registry: R,
  type: T,
  v: V,
  payload: z.input<R['definitions'][T][V]>,
  options: { key: string; at?: IsoTimestamp; id?: UuidV7 },
): Envelope<T, V, EventPayload<R, T, V>> {
  const schema = registry.definitions[type]?.[v]
  if (!schema) throw new Error(`${registry.module}: unknown event ${type} v${v}`)
  const envelope = EventEnvelope.parse({
    id: options.id ?? uuidv7(),
    type,
    v,
    at: options.at ?? isoNow(),
    key: options.key,
    payload: schema.parse(payload),
  })
  return envelope as Envelope<T, V, EventPayload<R, T, V>>
}

export type ParseEventResult<R extends EventRegistry> =
  | { success: true; data: EventOf<R> }
  | { success: false; error: string }

/**
 * Validates an incoming envelope against a registry: the envelope shape, then the payload schema
 * for its `type` and `v`. Consumers call this with the producer's registry.
 */
export function safeParseEvent<R extends EventRegistry>(
  registry: R,
  raw: unknown,
): ParseEventResult<R> {
  const envelope = EventEnvelope.safeParse(raw)
  if (!envelope.success) return { success: false, error: z.prettifyError(envelope.error) }
  const { type, v } = envelope.data
  const schema = registry.definitions[type]?.[v]
  if (!schema) {
    return { success: false, error: `${registry.module} does not declare ${type} v${v}` }
  }
  const payload = schema.safeParse(envelope.data.payload)
  if (!payload.success) {
    return { success: false, error: `${type} v${v}: ${z.prettifyError(payload.error)}` }
  }
  return { success: true, data: { ...envelope.data, payload: payload.data } as EventOf<R> }
}

export function parseEvent<R extends EventRegistry>(registry: R, raw: unknown): EventOf<R> {
  const result = safeParseEvent(registry, raw)
  if (!result.success) throw new Error(result.error)
  return result.data
}

/** The pipeline idempotency key for one listing: `source + sourceListingId + contentHash`. */
export function listingKey(listing: {
  source: Source
  sourceListingId: string
  contentHash: string
}): string {
  return IdempotencyKey.parse(`${listing.source}:${listing.sourceListingId}:${listing.contentHash}`)
}

/**
 * The idempotency key for a batch event: SHA-256 of the type and the sorted, de-duplicated
 * per-item keys (usually `listingKey`s), so the same batch in any order gets the same key.
 */
export async function batchKey(type: string, itemKeys: readonly string[]): Promise<string> {
  const unique = [...new Set(itemKeys)].sort()
  const data = new TextEncoder().encode([EventType.parse(type), ...unique].join('\n'))
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `${type}:${hex}`
}
