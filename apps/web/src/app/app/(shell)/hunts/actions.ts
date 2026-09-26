'use server'

import { call } from '@orpc/server'
import { redirect } from 'next/navigation'
import type { WantManagerCadenceSeconds } from '@/data/types'
import { rpcCallOptions } from '@/rpc/call'
import { router } from '@/rpc/router'

/**
 * A want's spec, as the hunt form collects it (task L1). want-manager's `criteria` are a
 * structured `partType`/`family` list; the form still collects free-text "terms" (rtx 3070, rtx
 * 3080), so each comma-separated term becomes one GPU criterion named by family. There is no
 * `name` or `category` field on a want, so those two inputs are not persisted — recorded in
 * docs/questions/L1-web.md.
 */
function criteriaFromTerms(termsInput: string) {
  const terms = termsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10)
  return terms.map((family) => ({
    partType: 'gpu' as const,
    catalogueId: null,
    family,
    minAttr: null,
    orBetter: false,
  }))
}

function deliveryMethodsFromDelivery(delivery: string): Array<'collection' | 'posted'> {
  if (delivery === 'collection') return ['collection']
  if (delivery === 'posted') return ['posted']
  return ['collection', 'posted']
}

export async function saveHunt(formData: FormData): Promise<{ error?: string }> {
  const postcode = String(formData.get('postcode') ?? '').trim()
  const terms = String(formData.get('terms') ?? '')
  const maxAsk = String(formData.get('maxAsk') ?? '').trim()
  const wantId = String(formData.get('wantId') ?? '').trim() || undefined
  const input = {
    wantId,
    postcode,
    radiusKm: Number(formData.get('radius') ?? 40),
    priceCapMinor: maxAsk ? Math.round(Number(maxAsk) * 100) : null,
    currency: 'GBP' as const,
    active: formData.get('active') !== 'false',
    // No UI control yet for these four (docs/questions/L1-web.md): conservative, off defaults.
    deliverySpeed: 'batched_15' as const,
    alternatives: 'off' as const,
    pcContainment: false,
    alternativesMaxPriceMinor: null,
    instantAlternatives: false,
    instantTopPicks: false,
    deliveryMethods: deliveryMethodsFromDelivery(String(formData.get('delivery') ?? 'all')),
    cadenceSeconds: Number(formData.get('cadenceSeconds')) as WantManagerCadenceSeconds,
    filter: null,
    criteria: criteriaFromTerms(terms),
  }
  const result = await call(router.wants.upsert, input, await rpcCallOptions())
  if (!result.ok) return { error: result.error.message }
  redirect('/app/hunts')
}

export async function setHuntActive(wantId: string, active: boolean): Promise<void> {
  await call(router.wants.setActive, { wantId, active }, await rpcCallOptions())
}

export async function deleteHunt(wantId: string): Promise<void> {
  await call(router.wants.delete, { wantId }, await rpcCallOptions())
  redirect('/app/hunts')
}
