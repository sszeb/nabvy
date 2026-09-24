// Drizzle Kit configuration for the incidents module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate incidents` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/incidents.ts',
  out: './migrations/incidents',
  schemaFilter: ['incidents'],
  migrations: { prefix: 'supabase' },
})
