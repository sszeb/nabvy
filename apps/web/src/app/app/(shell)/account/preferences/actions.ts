'use server'

import { call } from '@orpc/server'
import { rpcCallOptions } from '@/rpc/call'
import { router } from '@/rpc/router'

export async function getAlertPreferences() {
  return call(router.preferences.get, undefined, await rpcCallOptions())
}

export async function saveAlertPreferences(formData: FormData) {
  const channels = formData.getAll('channels').map(String)
  await call(
    router.preferences.set,
    {
      hideNoise: formData.get('hideNoise') === 'on',
      hideSpam: formData.get('hideSpam') === 'on',
      hideMultiQuantity: formData.get('hideMultiQuantity') === 'on',
      channels: channels as Array<'push' | 'telegram' | 'email'>,
      quietHours: null,
    },
    await rpcCallOptions(),
  )
}
