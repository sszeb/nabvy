// Drizzle Kit configuration for the marketing-consent module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate marketing-consent` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/marketing-consent.ts',
  out: './migrations/marketing-consent',
  schemaFilter: ['marketing_consent'],
  migrations: { prefix: 'supabase' },
})
