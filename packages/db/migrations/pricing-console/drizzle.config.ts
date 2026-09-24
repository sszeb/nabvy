// Drizzle Kit configuration for the pricing-console module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate pricing-console` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/pricing-console.ts',
  out: './migrations/pricing-console',
  schemaFilter: ['pricing_console'],
  migrations: { prefix: 'supabase' },
})
