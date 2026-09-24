// Database access to the switches schema only. Reads go through the SQL functions, so code and
// views share one definition of "off" for an unknown name.
import type { Queryable } from '@nabvy/db'
import { switches, vState } from '@nabvy/db/schema/switches'
import { asc, eq, sql } from 'drizzle-orm'
import type { SwitchValue } from '../domain'

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

export async function selectState(q: Queryable, name: string): Promise<unknown> {
  const result = await q.execute(sql`select switches.state(${name}) as state`)
  return rowsOf<{ state: unknown }>(result)[0]?.state
}

export async function selectGateAllows(
  q: Queryable,
  gate: string,
  userId: string,
): Promise<boolean> {
  const result = await q.execute(
    sql`select switches.gate_allows(${gate}, ${userId}::uuid) as allowed`,
  )
  return rowsOf<{ allowed: unknown }>(result)[0]?.allowed === true
}

/** The current row, locked until the transaction ends so concurrent changes queue. */
export async function selectForUpdate(
  q: Queryable,
  name: string,
): Promise<(SwitchValue & { changedAt: Date }) | undefined> {
  const [row] = await q
    .select({
      kind: switches.kind,
      state: switches.state,
      allowList: switches.allowList,
      changedAt: switches.changedAt,
    })
    .from(switches)
    .where(eq(switches.name, name))
    .for('update')
  return row as (SwitchValue & { changedAt: Date }) | undefined
}

/** Writes the new value and returns its change time. */
export async function upsertSwitch(
  q: Queryable,
  name: string,
  value: SwitchValue,
  changedBy: string,
): Promise<Date> {
  const set = { state: value.state, allowList: value.allowList, changedAt: sql`now()`, changedBy }
  const [row] = await q
    .insert(switches)
    .values({ name, kind: value.kind, ...set })
    .onConflictDoUpdate({ target: switches.name, set })
    .returning({ changedAt: switches.changedAt })
  if (!row) throw new Error(`switch ${name} was not written`)
  return row.changedAt
}

/** A row of `v_state` with its time as an ISO string; `list()` parses it. */
export type StateViewRow = Omit<typeof vState.$inferSelect, 'changedAt'> & { changedAt: string }

export async function selectAll(q: Queryable): Promise<StateViewRow[]> {
  const rows = await q.select().from(vState).orderBy(asc(vState.kind), asc(vState.name))
  return rows.map((row) => ({ ...row, changedAt: row.changedAt.toISOString() }))
}
