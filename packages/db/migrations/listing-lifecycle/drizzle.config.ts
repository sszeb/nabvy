// Drizzle Kit configuration for the listing-lifecycle module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate listing-lifecycle` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/listing-lifecycle.ts',
  out: './migrations/listing-lifecycle',
  schemaFilter: ['listing_lifecycle'],
  migrations: { prefix: 'supabase' },
})
