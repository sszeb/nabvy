// Drizzle Kit configuration for the account module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate account` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/account.ts',
  out: './migrations/account',
  schemaFilter: ['account'],
  migrations: { prefix: 'supabase' },
})
