import { loadEnv } from '@nabvy/config'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

/**
 * The two application roles (docs/engineering.md, "Database access"): `app` for the web app,
 * `pipeline` for pipeline tasks. Both are subject to RLS; neither has BYPASSRLS. Migrations run
 * as `postgres` through the runner, never through this client.
 */
export type DbRole = 'app' | 'pipeline'

export type Db = NodePgDatabase<Record<string, never>>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/** A database handle or an open transaction; module repo functions accept either. */
export type Queryable = Db | Tx

export interface DbHandle {
  db: Db
  pool: pg.Pool
}

/**
 * Opens a pool for a role. Supabase's pooler runs in transaction mode, so nothing may rely on
 * session state outside a transaction (docs/engineering.md); `withUser` sets the user per
 * transaction for that reason.
 */
export function createDb(connectionString: string, options: pg.PoolConfig = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: 10, ...options })
  return { db: drizzle(pool), pool }
}

const handles = new Map<DbRole, DbHandle>()

/** The process-wide handle for a role, configured from `@nabvy/config`. */
export function getDb(role: DbRole): Db {
  let handle = handles.get(role)
  if (!handle) {
    const url =
      role === 'app'
        ? loadEnv(['database']).DATABASE_URL
        : loadEnv(['pipelineDatabase']).DATABASE_URL_PIPELINE
    handle = createDb(url)
    handles.set(role, handle)
  }
  return handle.db
}

/** Closes every pool opened by `getDb` (for scripts and graceful shutdown). */
export async function closeDbs(): Promise<void> {
  const open = [...handles.values()]
  handles.clear()
  await Promise.all(open.map(({ pool }) => pool.end()))
}
