'use server'

import { call } from '@orpc/server'
import { rpcCallOptions } from '@/rpc/call'
import { router } from '@/rpc/router'

export async function exportAccountData() {
  return call(router.account.export, undefined, await rpcCallOptions())
}

export async function requestAccountDeletion() {
  return call(router.account.requestDeletion, undefined, await rpcCallOptions())
}
