// Drizzle Kit configuration for the waitlist module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate waitlist` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/waitlist.ts',
  out: './migrations/waitlist',
  schemaFilter: ['waitlist'],
  migrations: { prefix: 'supabase' },
})
