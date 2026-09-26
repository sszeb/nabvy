// Public API of the router-gateway module: the only code that calls a routing provider, and only
// server-side. Other modules import from '@nabvy/router-gateway' only, never from its internals.
// Every refusal or failure throws `RouterError`; callers catch it and fall back to straight
// line × 1.3, labelled an estimate (docs/design/modules/router-gateway.md).
import {
  config,
  loadRouterGatewayEnv,
  type RouterGatewayEnv,
} from '@nabvy/config/modules/router-gateway'
import { createEvent } from '@nabvy/contracts'
import {
  events,
  type RouterCallKind,
  type RouterErrorCode,
  type RouterHealth,
  type RouterProviderName,
  RouterRouteInput,
  type RouterRouteResult,
  RouterTableInput,
  type RouterTableResult,
} from '@nabvy/contracts/modules/router-gateway'
import { type Queryable, withPipeline } from '@nabvy/db'
import { state } from '@nabvy/switches'
import type { Publisher } from '@nabvy/transport'
import {
  buildChanged,
  judgeHealth,
  openrouteservice,
  type ProviderRequest,
  ProviderResponseInvalid,
  type RouterProvider,
} from './domain'
import { atCap, previousSuccess, recentStatuses, reserve, settle } from './repo'

export { events, module } from '@nabvy/contracts/modules/router-gateway'
export type { RouterProvider } from './domain'

/** A typed refusal or failure. `code` is one of `RouterErrorCode`; the message holds no coordinate or key. */
export class RouterError extends Error {
  readonly code: RouterErrorCode
  constructor(code: RouterErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'RouterError'
    this.code = code
  }
}

/** Runs `fn` in one committed pipeline transaction. */
export type RouterRun = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>

export interface RouterDeps {
  /** Receives `router.build-changed`. */
  publisher: Publisher
  /**
   * Runs one transaction as the pipeline role; defaults to `withPipeline`. The gateway commits
   * its quota reservation before the provider call and the outcome after it, in transactions of
   * its own, so no transaction stays open across HTTP and a failed call still counts.
   */
  run?: RouterRun
  /** Defaults to the environment through @nabvy/config. */
  env?: RouterGatewayEnv
  /** Defaults to the platform fetch; tests pass recorded responses. */
  fetch?: typeof fetch
  now?: () => Date
  /** Log sink; receives provider, kind, location count, latency and status only. */
  log?: (line: RouterLogLine) => void
}

export interface RouterLogLine {
  provider: RouterProviderName
  kind: RouterCallKind
  locationCount: number
  latencyMs: number | null
  status: string
}

/** Providers built so far. `osrm` joins when a self-hosted router exists. */
const PROVIDERS: Partial<Record<RouterProviderName, RouterProvider>> = { openrouteservice }

const MODULE_SWITCH = 'router-gateway'

function envOf(deps: { env?: RouterGatewayEnv }): RouterGatewayEnv {
  if (deps.env) return deps.env
  try {
    return loadRouterGatewayEnv()
  } catch {
    throw new RouterError('router.unconfigured')
  }
}

/** Open while the module switch is on or in shadow (no user-facing output) and the provider's switch is on. */
async function open(q: Queryable, provider: RouterProviderName): Promise<boolean> {
  const moduleState = await state(q, MODULE_SWITCH)
  return moduleState !== 'off' && (await state(q, provider)) === 'on'
}

/** Reads at most `limit` bytes of a body; more is refused. */
async function readBounded(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > limit) throw new ProviderResponseInvalid('too large')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new ProviderResponseInvalid('too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

const runOf = (deps: { run?: RouterRun }): RouterRun => deps.run ?? ((fn) => withPipeline(fn))

async function call<T extends { build: string | null }>(
  deps: RouterDeps,
  kind: 'table' | 'route',
  locationCount: number,
  request: (provider: RouterProvider) => ProviderRequest,
  parse: (provider: RouterProvider, json: unknown) => T,
): Promise<T & { provider: RouterProviderName }> {
  const env = envOf(deps)
  const provider = PROVIDERS[env.ROUTER_PROVIDER]
  if (!provider)
    throw new RouterError('router.unconfigured', `no adapter for ${env.ROUTER_PROVIDER}`)
  const run = runOf(deps)
  const now = deps.now ?? (() => new Date())
  const log = (latencyMs: number | null, status: string) =>
    deps.log?.({ provider: provider.name, kind, locationCount, latencyMs, status })
  const id = await run(async (q) => {
    if (!(await open(q, provider.name))) throw new RouterError('router.off')
    return reserve(
      q,
      { provider: provider.name, kind, locationCount },
      config.quota[provider.name][kind],
      now(),
    )
  })
  if (!id) {
    log(null, 'refused_quota')
    throw new RouterError('router.quota')
  }

  const { method, path, body } = request(provider)
  const started = now().getTime()
  const fail = async (
    status: 'provider_quota' | 'http_error' | 'invalid_response' | 'timeout' | 'network_error',
    code: RouterErrorCode,
    detail?: string,
  ): Promise<never> => {
    const latencyMs = now().getTime() - started
    await run((q) => settle(q, id, { status, latencyMs, build: null }))
    log(latencyMs, status)
    throw new RouterError(code, detail)
  }

  let json: unknown
  try {
    const response = await (deps.fetch ?? fetch)(new URL(path, env.ROUTER_BASE_URL), {
      method,
      headers: {
        ...provider.authHeader(env.ROUTER_API_KEY),
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
      redirect: 'error',
    })
    if (response.status === 429) return await fail('provider_quota', 'router.quota', 'provider 429')
    if (!response.ok) return await fail('http_error', 'router.provider', `HTTP ${response.status}`)
    json = JSON.parse(await readBounded(response, config.maxResponseBytes))
  } catch (error) {
    if (error instanceof RouterError) throw error
    if (error instanceof ProviderResponseInvalid || error instanceof SyntaxError) {
      return await fail('invalid_response', 'router.invalid-response')
    }
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    return await fail(
      timedOut ? 'timeout' : 'network_error',
      'router.provider',
      timedOut ? 'timeout' : 'network',
    )
  }

  let result: T
  try {
    result = parse(provider, json)
  } catch {
    return await fail('invalid_response', 'router.invalid-response')
  }

  const latencyMs = now().getTime() - started
  const previous = await run(async (q) => {
    await settle(q, id, { status: 'ok', latencyMs, build: result.build })
    return previousSuccess(q, id)
  })
  log(latencyMs, 'ok')

  if (buildChanged(previous, { provider: provider.name, build: result.build })) {
    const osmBuild = result.build ?? 'unknown'
    await deps.publisher.publish([
      createEvent(
        events,
        'router.build-changed',
        1,
        { provider: provider.name, osmBuild, at: now().toISOString() },
        { key: `router.build-changed:${provider.name}@${osmBuild}` },
      ),
    ])
  }
  return { ...result, provider: provider.name }
}

function checkSize(count: number, limit: number): void {
  if (count > limit) throw new RouterError('router.too-large', `${count} > ${limit}`)
}

/**
 * Road distance (metres) and time (seconds) from every source to every destination, in one
 * provider call. Throws `RouterError`; `router.off` and `router.quota` write no provider call.
 */
export async function table(input: RouterTableInput, deps: RouterDeps): Promise<RouterTableResult> {
  const { sources, destinations } = RouterTableInput.parse(input)
  const count = sources.length + destinations.length
  checkSize(count, config.maxTableLocations)
  return call(
    deps,
    'table',
    count,
    (provider) => provider.tableRequest(sources, destinations),
    (provider, json) => provider.parseTable(json, sources.length, destinations.length),
  )
}

/** Road distance (metres) and time (seconds) through the stops in order. Throws `RouterError`. */
export async function route(input: RouterRouteInput, deps: RouterDeps): Promise<RouterRouteResult> {
  const { points } = RouterRouteInput.parse(input)
  checkSize(points.length, config.maxRouteStops)
  return call(
    deps,
    'route',
    points.length,
    (provider) => provider.routeRequest(points),
    (provider, json) => provider.parseRoute(json),
  )
}

/**
 * The configured provider's state, without calling it (openrouteservice's public API has no
 * health endpoint, and a probe would spend quota): unconfigured, off, at quota, or judged from
 * the calls of the last `healthWindowMinutes`. Never throws for a provider problem.
 */
export async function health(deps: Omit<RouterDeps, 'publisher'> = {}): Promise<RouterHealth> {
  const now = (deps.now ?? (() => new Date()))()
  const checkedAt = now.toISOString()
  let env: RouterGatewayEnv
  try {
    env = envOf(deps)
  } catch {
    return {
      provider: 'openrouteservice',
      status: 'unconfigured',
      build: null,
      checkedAt,
    }
  }
  const provider = env.ROUTER_PROVIDER
  if (!PROVIDERS[provider]) return { provider, status: 'unconfigured', build: null, checkedAt }
  return runOf(deps)(async (q) => {
    if (!(await open(q, provider)))
      return { provider, status: 'off' as const, build: null, checkedAt }
    const since = new Date(now.getTime() - config.healthWindowMinutes * 60_000)
    const { statuses, lastBuild } = await recentStatuses(q, provider, since)
    const quota = config.quota[provider]
    const bothAtCap =
      (await atCap(q, { provider, kind: 'table' }, quota.table, now)) &&
      (await atCap(q, { provider, kind: 'route' }, quota.route, now))
    return {
      provider,
      status: bothAtCap ? 'quota' : judgeHealth(statuses),
      build: lastBuild,
      checkedAt,
    }
  })
}
