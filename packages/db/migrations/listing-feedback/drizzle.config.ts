// Drizzle Kit configuration for the listing-feedback module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate listing-feedback` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/listing-feedback.ts',
  out: './migrations/listing-feedback',
  schemaFilter: ['listing_feedback'],
  migrations: { prefix: 'supabase' },
})
