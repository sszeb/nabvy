// Drizzle Kit configuration for the price-drop-watch module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate price-drop-watch` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/price-drop-watch.ts',
  out: './migrations/price-drop-watch',
  schemaFilter: ['price_drop_watch'],
  migrations: { prefix: 'supabase' },
})
