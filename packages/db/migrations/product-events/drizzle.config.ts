// Drizzle Kit configuration for the product-events module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate product-events` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/product-events.ts',
  out: './migrations/product-events',
  schemaFilter: ['product_events'],
  migrations: { prefix: 'supabase' },
})
