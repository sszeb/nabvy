// Drizzle Kit configuration for the quote-redaction module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate quote-redaction` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/quote-redaction.ts',
  out: './migrations/quote-redaction',
  schemaFilter: ['quote_redaction'],
  migrations: { prefix: 'supabase' },
})
