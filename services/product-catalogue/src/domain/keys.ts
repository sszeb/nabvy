// Pure logic: no I/O. The idempotency key of `product-catalogue.updated` for one write: the
// affected catalogue IDs and the write's own time (rule 8 of docs/design/modules/_rules.md).
export function updatedKey(catalogueIds: string[], at: Date): string {
  return `product-catalogue.updated:${catalogueIds.join(',')}@${at.toISOString()}`
}
