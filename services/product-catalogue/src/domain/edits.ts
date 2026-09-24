// Pure logic: no I/O. Validates an admin edit and refuses one that would break a domain rule the
// database itself cannot express as a single-row check constraint.
import {
  ProductCatalogueAddAliasInput,
  ProductCatalogueAddCodeInput,
  ProductCatalogueAddItemInput,
  ProductCatalogueAddNegativeContextInput,
  type ProductCatalogueErrorCode,
} from '@nabvy/contracts/modules/product-catalogue'
import { ProductCatalogueRefused } from './errors'

function refused(code: ProductCatalogueErrorCode, message: string): never {
  throw new ProductCatalogueRefused(code, message)
}

/** Only a GPU has a mobile counterpart in this build; a CPU may not be added as `isMobile`. */
export function planAddItem(input: unknown) {
  const parsed = ProductCatalogueAddItemInput.safeParse(input)
  if (!parsed.success)
    refused('product-catalogue.invalid_input', `item refused: ${parsed.error.message}`)
  const item = parsed.data
  if (item.isMobile && item.kind !== 'gpu') {
    refused('product-catalogue.invalid_input', `${item.kind} has no mobile variant`)
  }
  return item
}

export function planAddAlias(input: unknown) {
  const parsed = ProductCatalogueAddAliasInput.safeParse(input)
  if (!parsed.success)
    refused('product-catalogue.invalid_input', `alias refused: ${parsed.error.message}`)
  return parsed.data
}

export function planAddNegativeContext(input: unknown) {
  const parsed = ProductCatalogueAddNegativeContextInput.safeParse(input)
  if (!parsed.success) {
    refused('product-catalogue.invalid_input', `negative context refused: ${parsed.error.message}`)
  }
  return parsed.data
}

export function planAddCode(input: unknown) {
  const parsed = ProductCatalogueAddCodeInput.safeParse(input)
  if (!parsed.success)
    refused('product-catalogue.invalid_input', `code refused: ${parsed.error.message}`)
  return parsed.data
}

/** The stored part of an item that a repeat `addItem` call compares, to write nothing when the
 * incoming values already match (mirrors services/switches/src/domain/index.ts's `sameValue`). */
export interface ItemValue {
  kind: string
  family: string | null
  variant: string | null
  isMobile: boolean
  packId: string | null
  name: string
}

export function sameItem(a: ItemValue, b: ItemValue): boolean {
  return (
    a.kind === b.kind &&
    a.family === b.family &&
    a.variant === b.variant &&
    a.isMobile === b.isMobile &&
    a.packId === b.packId &&
    a.name === b.name
  )
}
