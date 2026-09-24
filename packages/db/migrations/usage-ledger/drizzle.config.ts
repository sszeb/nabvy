// Drizzle Kit configuration for the usage-ledger module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate usage-ledger` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/usage-ledger.ts',
  out: './migrations/usage-ledger',
  schemaFilter: ['usage_ledger'],
  migrations: { prefix: 'supabase' },
})
