import 'server-only'

import { headers as nextHeaders } from 'next/headers'

/**
 * The calling options every server component and server action passes to oRPC's own `call()`
 * when invoking a procedure directly, in-process (no HTTP round trip) — CLAUDE.md, "or a plain
 * server action that calls the same procedure". Kept as a plain options object, not a wrapper
 * function, so `call(procedure, input, await rpcCallOptions())` keeps `call`'s own generic
 * inference of that procedure's input and output types.
 */
export async function rpcCallOptions() {
  return { context: { headers: await nextHeaders() } }
}
