// Drizzle Kit configuration for the listing-ingest module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate listing-ingest` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/listing-ingest.ts',
  out: './migrations/listing-ingest',
  schemaFilter: ['listing_ingest'],
  migrations: { prefix: 'supabase' },
})
