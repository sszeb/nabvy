// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.

/** Splits `items` into chunks of at most `size`, as `listing-suppression`'s own `chunk` does. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}
