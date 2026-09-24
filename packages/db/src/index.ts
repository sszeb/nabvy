// Shared database machinery. Module tables live in src/schema/<module>.ts and are imported from
// `@nabvy/db/schema/<module>`; see README.md.
export {
  closeDbs,
  createDb,
  type Db,
  type DbHandle,
  type DbRole,
  getDb,
  type Queryable,
  type Tx,
} from './client'
export {
  idColumn,
  moduleSchema,
  RESERVED_SCHEMAS,
  schemaNameOf,
  timestampColumns,
} from './module-schema'
export { withPipeline, withUser } from './with-user'
