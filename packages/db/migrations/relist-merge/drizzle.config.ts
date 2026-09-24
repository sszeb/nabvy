// Drizzle Kit configuration for the relist-merge module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate relist-merge` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/relist-merge.ts',
  out: './migrations/relist-merge',
  schemaFilter: ['relist_merge'],
  migrations: { prefix: 'supabase' },
})
