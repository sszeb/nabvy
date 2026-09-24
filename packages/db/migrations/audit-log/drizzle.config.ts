// Drizzle Kit configuration for the audit-log module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate audit-log` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/audit-log.ts',
  out: './migrations/audit-log',
  schemaFilter: ['audit_log'],
  migrations: { prefix: 'supabase' },
})
