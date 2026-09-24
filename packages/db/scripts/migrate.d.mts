export interface Migration {
  module: string
  name: string
  path: string
  sql: string
  checksum: string
}
export const migrationsDir: string
export function plan(dir?: string): Migration[]
export function ledgerSql(migration: Pick<Migration, 'module' | 'name' | 'checksum'>): string
export function guardSql(migration: Pick<Migration, 'module' | 'name'>): string
