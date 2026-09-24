import type { ProductCatalogueErrorCode } from '@nabvy/contracts/modules/product-catalogue'

/** Thrown by an admin-edit function: the change is refused and nothing is written. */
export class ProductCatalogueRefused extends Error {
  constructor(
    readonly code: ProductCatalogueErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProductCatalogueRefused'
  }
}
