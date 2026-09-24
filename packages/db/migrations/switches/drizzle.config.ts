// Drizzle Kit configuration for the switches module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate switches` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/switches.ts',
  out: './migrations/switches',
  schemaFilter: ['switches'],
  migrations: { prefix: 'supabase' },
})
