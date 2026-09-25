// Drizzle Kit configuration for the parts-rules module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate parts-rules` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/parts-rules.ts',
  out: './migrations/parts-rules',
  schemaFilter: ['parts_rules'],
  migrations: { prefix: 'supabase' },
})
