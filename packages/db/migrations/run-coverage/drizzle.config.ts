// Drizzle Kit configuration for the run-coverage module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate run-coverage` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/run-coverage.ts',
  out: './migrations/run-coverage',
  schemaFilter: ['run_coverage'],
  migrations: { prefix: 'supabase' },
})
