// Drizzle Kit configuration for the detail-evidence module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate detail-evidence` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/detail-evidence.ts',
  out: './migrations/detail-evidence',
  schemaFilter: ['detail_evidence'],
  migrations: { prefix: 'supabase' },
})
