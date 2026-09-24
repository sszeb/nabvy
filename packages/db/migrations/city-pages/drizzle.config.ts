// Drizzle Kit configuration for the city-pages module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate city-pages` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/city-pages.ts',
  out: './migrations/city-pages',
  schemaFilter: ['city_pages'],
  migrations: { prefix: 'supabase' },
})
