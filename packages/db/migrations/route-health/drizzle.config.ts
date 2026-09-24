// Drizzle Kit configuration for the route-health module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate route-health` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/route-health.ts',
  out: './migrations/route-health',
  schemaFilter: ['route_health'],
  migrations: { prefix: 'supabase' },
})
