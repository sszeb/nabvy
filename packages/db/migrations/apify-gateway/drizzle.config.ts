// Drizzle Kit configuration for the apify-gateway module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate apify-gateway` runs. See packages/db/README.md.
// The gateway's tables were created by supabase/migrations before this module existed, so this
// module's migrations are hand-written (services/apify-gateway/README.md, "Decisions").
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/apify-gateway.ts',
  out: './migrations/apify-gateway',
  schemaFilter: ['apify_gateway'],
  migrations: { prefix: 'supabase' },
})
