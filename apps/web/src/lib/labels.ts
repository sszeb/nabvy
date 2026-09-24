import type { Suspicion } from '@/data/types'

/** Every suspected-behaviour label starts with "Suspected": a suspicion, never a verdict. */
export const suspicionKindLabel: Record<Suspicion['kind'], string> = {
  trade_seller: 'Suspected trade seller',
  copy_advert: 'Suspected copied advert',
}

/** "Suspected trade seller: the description offers a warranty …". */
export function suspicionText(suspicion: Suspicion): string {
  return `${suspicionKindLabel[suspicion.kind]}: ${suspicion.facts}`
}
