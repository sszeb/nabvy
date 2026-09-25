// Drizzle Kit configuration for the location module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate location` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/location.ts',
  out: './migrations/location',
  schemaFilter: ['location'],
  migrations: { prefix: 'supabase' },
})
