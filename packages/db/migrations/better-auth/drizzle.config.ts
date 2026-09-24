// Drizzle Kit configuration for the better-auth module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate better-auth` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/better-auth.ts',
  out: './migrations/better-auth',
  schemaFilter: ['better_auth'],
  migrations: { prefix: 'supabase' },
})
