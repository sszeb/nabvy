import type {
  RouterPoint,
  RouterProviderName,
  RouterRouteResult,
  RouterTableResult,
} from '@nabvy/contracts/modules/router-gateway'

/** One HTTP request a provider adapter asks the gateway to send. The key is added by the caller. */
export interface ProviderRequest {
  method: 'POST' | 'GET'
  /** Path below ROUTER_BASE_URL, starting with '/'. */
  path: string
  body?: unknown
}

/**
 * The `RouterProvider` adapter (owner, 2026-09-25): pure request building and response mapping
 * for one routing provider. Switching providers is a config change (`ROUTER_PROVIDER`).
 * `parse*` receive untrusted JSON, validate it and return metres and seconds only; they throw
 * `ProviderResponseInvalid` on anything unexpected.
 */
export interface RouterProvider {
  name: RouterProviderName
  /** The header that carries the key, and how its value is written. */
  authHeader(key: string): Record<string, string>
  tableRequest(
    sources: readonly RouterPoint[],
    destinations: readonly RouterPoint[],
  ): ProviderRequest
  parseTable(
    json: unknown,
    sourceCount: number,
    destinationCount: number,
  ): Omit<RouterTableResult, 'provider'>
  routeRequest(points: readonly RouterPoint[]): ProviderRequest
  parseRoute(json: unknown): Omit<RouterRouteResult, 'provider'>
}

export class ProviderResponseInvalid extends Error {
  constructor(reason: string) {
    super(`routing provider response invalid: ${reason}`)
    this.name = 'ProviderResponseInvalid'
  }
}

/** A provider-reported data build, kept only if it looks like a date or version string. */
const BUILD = /^[0-9A-Za-z:._+-]{1,100}$/
export function safeBuild(value: unknown): string | null {
  return typeof value === 'string' && BUILD.test(value) ? value : null
}
