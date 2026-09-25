// Drizzle Kit configuration for the source-health module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate source-health` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/source-health.ts',
  out: './migrations/source-health',
  schemaFilter: ['source_health'],
  migrations: { prefix: 'supabase' },
})
