import { z } from 'zod'
import { defineEvents, IsoTimestamp, ModuleName, Uuid } from '../index'

// Contracts of the switches module (services/switches): the state of every module, provider,
// gate, feature flag and the global pipeline pause. Import from '@nabvy/contracts/modules/switches'.

export const module = 'switches'

/** What a switch controls (docs/design/modules/switches.md). */
export const SwitchesKind = z.enum(['module', 'provider', 'gate', 'flag', 'global'])
export type SwitchesKind = z.infer<typeof SwitchesKind>

/**
 * `off | shadow | on`. Only a module may be in `shadow` (rule 11 of _rules.md); providers, gates,
 * flags and the global pause are `on` or `off`. An unknown switch reads `off`.
 */
export const SwitchesState = z.enum(['off', 'shadow', 'on'])
export type SwitchesState = z.infer<typeof SwitchesState>

/** A switch's name: kebab case, unique across kinds. A module's switch is named after it. */
export const SwitchesName = ModuleName.max(100)
export type SwitchesName = z.infer<typeof SwitchesName>

/**
 * Switches that cannot be switched off (their cards): the audit log, incidents and switches
 * itself. The database refuses any other state for them too.
 */
export const SWITCHES_ALWAYS_ON = ['audit-log', 'incidents', 'switches'] as const

/** The global pipeline pause: `off` pauses the pipeline. */
export const SWITCHES_PIPELINE = 'pipeline'

/** At most this many user IDs on one gate's allow-list. */
export const SWITCHES_ALLOW_LIST_MAX = 1000

/**
 * A gate's allow-list: null opens the gate to every user while it is `on`; a list admits only
 * those users. Only gates carry one. An empty list is refused: close a gate by switching it off.
 */
export const SwitchesAllowList = z.array(Uuid).min(1).max(SWITCHES_ALLOW_LIST_MAX).nullable()
export type SwitchesAllowList = z.infer<typeof SwitchesAllowList>

const stateFitsKind = (s: { kind: SwitchesKind; state: SwitchesState }) =>
  s.kind === 'module' || s.state !== 'shadow'
const allowListFitsKind = (s: { kind: SwitchesKind; allowList?: SwitchesAllowList }) =>
  s.kind === 'gate' || s.allowList == null

/**
 * What an admin procedure passes to `set()`, after it has checked the session is an admin's.
 * `allowList` is for gates only; omitted, a gate keeps its current list.
 */
export const SwitchesSetInput = z
  .strictObject({
    actorUserId: Uuid,
    name: SwitchesName,
    kind: SwitchesKind,
    state: SwitchesState,
    allowList: SwitchesAllowList.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .refine(stateFitsKind, { message: 'only a module can be in shadow', path: ['state'] })
  .refine(allowListFitsKind, { message: 'only a gate has an allow-list', path: ['allowList'] })
export type SwitchesSetInput = z.infer<typeof SwitchesSetInput>

/**
 * One row of `switches.v_state`. Its shape follows the Drizzle view declaration in
 * packages/db/src/schema/switches.ts; services/switches/test/contracts.test.ts fails if they drift.
 * `changedBy` is null for rows seeded by a migration.
 */
export const SwitchesSwitch = z
  .strictObject({
    name: SwitchesName,
    kind: SwitchesKind,
    state: SwitchesState,
    allowList: SwitchesAllowList,
    changedAt: IsoTimestamp,
    changedBy: Uuid.nullable(),
  })
  .refine(stateFitsKind, { message: 'only a module can be in shadow', path: ['state'] })
  .refine(allowListFitsKind, { message: 'only a gate has an allow-list', path: ['allowList'] })
export type SwitchesSwitch = z.infer<typeof SwitchesSwitch>

/**
 * `switches.invalid_input`: the input failed `SwitchesSetInput`.
 * `switches.always_on`: the switch cannot leave `on` (`SWITCHES_ALWAYS_ON`).
 * `switches.kind_mismatch`: the name exists with another kind.
 */
export const SwitchesErrorCode = z.enum([
  'switches.invalid_input',
  'switches.always_on',
  'switches.kind_mismatch',
])
export type SwitchesErrorCode = z.infer<typeof SwitchesErrorCode>

/** The payload of `switches.changed`: switches whose state or allow-list changed. */
export const SwitchesChangedEvent = z.strictObject({
  names: z.array(SwitchesName).min(1).max(500),
})
export type SwitchesChangedEvent = z.infer<typeof SwitchesChangedEvent>

/** Events this module publishes. A breaking payload change adds a version. */
export const events = defineEvents(module, {
  /** Readers load the new state by name. */
  'switches.changed': { 1: SwitchesChangedEvent },
})
