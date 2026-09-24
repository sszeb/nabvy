// Drizzle Kit configuration for the details-queue module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate details-queue` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/details-queue.ts',
  out: './migrations/details-queue',
  schemaFilter: ['details_queue'],
  migrations: { prefix: 'supabase' },
})
