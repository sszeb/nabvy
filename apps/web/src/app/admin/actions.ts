'use server'

import type { SwitchesKind, SwitchesState } from '@nabvy/contracts/modules/switches'
import { call } from '@orpc/server'
import { revalidatePath } from 'next/cache'
import { rpcCallOptions } from '@/rpc/call'
import { router } from '@/rpc/router'

export async function setSwitchAction(input: {
  name: string
  kind: SwitchesKind
  state: SwitchesState
}) {
  await call(router.admin.switches.set, input, await rpcCallOptions())
  revalidatePath('/admin')
  revalidatePath('/admin/switches')
}

export async function retryIncidentAction(incidentId: string) {
  return call(router.admin.incidents.retry, { incidentId }, await rpcCallOptions())
}
