// Drizzle Kit configuration for the travel-cost module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate travel-cost` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/travel-cost.ts',
  out: './migrations/travel-cost',
  schemaFilter: ['travel_cost'],
  migrations: { prefix: 'supabase' },
})
