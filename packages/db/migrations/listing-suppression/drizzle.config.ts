// Drizzle Kit configuration for the listing-suppression module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate listing-suppression` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/listing-suppression.ts',
  out: './migrations/listing-suppression',
  schemaFilter: ['listing_suppression'],
  migrations: { prefix: 'supabase' },
})
