// Public API of the inventory module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/inventory' only, never from its internals. It records the
// items a user bought and sold, with profit (README.md). Everything runs inside withUser, as
// nabvy_app: row-level security is the only isolation a caller needs, and every amount and date
// is the user's own entry (CLAUDE.md, "No invented numbers").
import { isActive } from '@nabvy/account'
import { createEvent, type EventEnvelope, err, ok, type Result } from '@nabvy/contracts'
import {
  events,
  InventoryAddItemInput,
  type InventoryError,
  type InventoryItem,
  InventoryRecordSaleInput,
} from '@nabvy/contracts/modules/inventory'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { checkCurrency, checkDates, dateOf, outcomeKey } from './domain'
import {
  findItem,
  type ItemRow,
  insertItem,
  listingOnCard,
  selectItems,
  setSale,
  userScan,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/inventory'
export { onAccountDeleted } from './handlers'

export interface AddItemOutcome {
  itemId: string
  /** Whether this call wrote the row (false: the same form was already submitted). */
  created: boolean
}

export interface RecordSaleOutcome {
  itemId: string
  /** Whether this call changed the stored sale (false: the same sale was already recorded). */
  changed: boolean
  /** Profit in minor units, sold minus cost, in the item's currency. */
  profitMinor: number
  /** `inventory.outcome-recorded`, for the caller to publish after its transaction commits. */
  event: EventEnvelope
}

async function gate(q: Queryable, userId: string): Promise<Result<undefined, InventoryError>> {
  if ((await state(q, 'inventory')) === 'off') {
    return err({ code: 'inventory.off', message: 'Inventory is unavailable.' })
  }
  if (!(await isActive(q, userId))) {
    return err({
      code: 'inventory.account_restricted',
      message: 'The account may not use inventory right now.',
    })
  }
  return ok(undefined)
}

const sameItem = (row: ItemRow, input: InventoryAddItemInput, productKey: string | null) =>
  row.productKey === productKey &&
  row.sourceListingId === (input.sourceListingId ?? null) &&
  row.scanId === (input.scanId ?? null) &&
  row.currency === input.cost.currency &&
  row.costMinor === input.cost.amountMinor &&
  row.boughtAt === input.boughtAt

/**
 * Records an item the user bought (docs/design/modules/inventory.md): what it is (a product key,
 * a listing on their card, or one of their own scans), what it cost and when. Safe to run twice:
 * the client's `itemId` makes a resubmitted form the same item, never a second row. A scan fills
 * in the product key when the form leaves it out (README.md, "Decisions").
 */
export async function addItem(
  q: Queryable,
  rawInput: InventoryAddItemInput,
  options: { now?: Date } = {},
): Promise<Result<AddItemOutcome, InventoryError>> {
  const parsed = InventoryAddItemInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'inventory.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  const gated = await gate(q, input.userId)
  if (!gated.ok) return gated
  const dates = checkDates({ boughtAt: input.boughtAt, today: dateOf(options.now ?? new Date()) })
  if (dates) return err(dates)

  let productKey = input.productKey ?? null
  if (input.scanId) {
    const scan = await userScan(q, input.scanId)
    if (!scan) {
      return err({ code: 'inventory.scan_not_found', message: 'That scan is not one of yours.' })
    }
    productKey ??= scan.identified
  }
  if (input.sourceListingId && !(await listingOnCard(q, input.sourceListingId))) {
    return err({ code: 'inventory.listing_not_found', message: 'That listing is not available.' })
  }

  const inserted = await insertItem(q, {
    id: input.itemId,
    userId: input.userId,
    productKey,
    sourceListingId: input.sourceListingId ?? null,
    scanId: input.scanId ?? null,
    currency: input.cost.currency,
    costMinor: input.cost.amountMinor,
    boughtAt: input.boughtAt,
  })
  if (inserted) return ok({ itemId: inserted.id, created: true })

  const existing = await findItem(q, input.itemId)
  if (existing && sameItem(existing, input, productKey)) {
    return ok({ itemId: existing.id, created: false })
  }
  return err({ code: 'inventory.conflict', message: 'That item ID is already in use.' })
}

/**
 * Records what an item sold for, when and where, or corrects it. Safe to run twice: the same sale
 * changes nothing and republishes the same event key, which the transport drops. The sale must be
 * in the item's own currency and dated no earlier than the purchase and no later than today
 * (server time). Emits `inventory.outcome-recorded`, which sold-reports acts on only with the
 * user's separate consent (module card).
 */
export async function recordSale(
  q: Queryable,
  rawInput: InventoryRecordSaleInput,
  options: { now?: Date } = {},
): Promise<Result<RecordSaleOutcome, InventoryError>> {
  const parsed = InventoryRecordSaleInput.safeParse(rawInput)
  if (!parsed.success) {
    return err({ code: 'inventory.invalid_input', message: parsed.error.message })
  }
  const input = parsed.data
  const gated = await gate(q, input.userId)
  if (!gated.ok) return gated

  const item = await findItem(q, input.itemId)
  if (!item) return err({ code: 'inventory.not_found', message: 'No such item.' })
  const currency = checkCurrency(item.currency as 'GBP' | 'EUR', input.sold)
  if (currency) return err(currency)
  const now = options.now ?? new Date()
  const dates = checkDates({ boughtAt: item.boughtAt, soldAt: input.soldAt, today: dateOf(now) })
  if (dates) return err(dates)

  const soldOn = input.soldOn ?? null
  const unchanged =
    item.soldMinor === input.sold.amountMinor &&
    item.soldAt === input.soldAt &&
    item.soldOn === soldOn
  const row = unchanged
    ? item
    : await setSale(q, item.id, {
        soldMinor: input.sold.amountMinor,
        soldAt: input.soldAt,
        soldOn,
        recordedAt: now,
      })
  if (!row || row.soldMinor == null || row.soldAt == null) {
    return err({ code: 'inventory.not_found', message: 'No such item.' })
  }
  return ok({
    itemId: row.id,
    changed: !unchanged,
    profitMinor: row.soldMinor - row.costMinor,
    event: createEvent(
      events,
      'inventory.outcome-recorded',
      1,
      { itemIds: [row.id] },
      {
        key: outcomeKey({
          id: row.id,
          soldMinor: row.soldMinor,
          currency: row.currency,
          soldAt: row.soldAt,
          soldOn: row.soldOn,
        }),
      },
    ) as EventEnvelope,
  })
}

/**
 * The caller's own items, newest purchase first, in `app.v_inventory_items`'s row shape. Empty
 * while the module is not on (the view's switch filter), never an error.
 */
export function itemsFor(q: Queryable): Promise<InventoryItem[]> {
  return selectItems(q)
}

export type { ItemRow }
