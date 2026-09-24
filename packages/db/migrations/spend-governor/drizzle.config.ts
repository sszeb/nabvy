// Drizzle Kit configuration for the spend-governor module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate spend-governor` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/spend-governor.ts',
  out: './migrations/spend-governor',
  schemaFilter: ['spend_governor'],
  migrations: { prefix: 'supabase' },
})
