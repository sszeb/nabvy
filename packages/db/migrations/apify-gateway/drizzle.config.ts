// Drizzle Kit configuration for the apify-gateway module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate apify-gateway` runs. See packages/db/README.md.
// The gateway's tables were created by supabase/migrations before this module existed, so this
// module's migrations are hand-written (services/apify-gateway/README.md, "Decisions"). Do not run
// `pnpm db:generate apify-gateway` without `--custom`: with no snapshot it would emit a full CREATE
// of tables that already exist.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/apify-gateway.ts',
  out: './migrations/apify-gateway',
  schemaFilter: ['apify_gateway'],
  migrations: { prefix: 'supabase' },
})
