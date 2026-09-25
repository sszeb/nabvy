// Drizzle Kit configuration for the subscriptions module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate subscriptions` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/subscriptions.ts',
  out: './migrations/subscriptions',
  schemaFilter: ['subscriptions'],
  migrations: { prefix: 'supabase' },
})
