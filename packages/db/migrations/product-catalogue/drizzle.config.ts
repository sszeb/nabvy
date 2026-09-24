// Drizzle Kit configuration for the product-catalogue module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate product-catalogue` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/product-catalogue.ts',
  out: './migrations/product-catalogue',
  schemaFilter: ['product_catalogue'],
  migrations: { prefix: 'supabase' },
})
