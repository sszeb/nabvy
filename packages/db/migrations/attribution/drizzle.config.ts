// Drizzle Kit configuration for the attribution module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate attribution` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/attribution.ts',
  out: './migrations/attribution',
  schemaFilter: ['attribution'],
  migrations: { prefix: 'supabase' },
})
