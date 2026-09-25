// Drizzle Kit configuration for the parts-ai module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate parts-ai` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/parts-ai.ts',
  out: './migrations/parts-ai',
  schemaFilter: ['parts_ai'],
  migrations: { prefix: 'supabase' },
})
