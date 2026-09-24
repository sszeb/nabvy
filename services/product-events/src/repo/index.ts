// Database access to the product_events schema only. Other modules read product_events.v_events,
// never this file.
import type { Queryable } from '@nabvy/db'
import { events } from '@nabvy/db/schema/product-events'
import type { EventInsert } from '../domain'

export async function insertEvent(
  db: Queryable,
  userId: string,
  values: EventInsert,
  sessionId: string | null,
): Promise<void> {
  await db.insert(events).values({
    userId,
    event: values.event,
    properties: values.properties,
    sessionId,
  })
}
