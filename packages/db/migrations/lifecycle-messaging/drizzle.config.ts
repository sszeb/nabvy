// Drizzle Kit configuration for the lifecycle-messaging module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate lifecycle-messaging` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/lifecycle-messaging.ts',
  out: './migrations/lifecycle-messaging',
  schemaFilter: ['lifecycle_messaging'],
  migrations: { prefix: 'supabase' },
})
