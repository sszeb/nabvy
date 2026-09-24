// Drizzle Kit configuration for the cost-meter module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate cost-meter` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/cost-meter.ts',
  out: './migrations/cost-meter',
  schemaFilter: ['cost_meter'],
  migrations: { prefix: 'supabase' },
})
