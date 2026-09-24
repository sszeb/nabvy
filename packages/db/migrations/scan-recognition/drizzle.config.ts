// Drizzle Kit configuration for the scan-recognition module's migrations. Paths are relative to
// packages/db, where `pnpm db:generate scan-recognition` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/scan-recognition.ts',
  out: './migrations/scan-recognition',
  schemaFilter: ['scan_recognition'],
  migrations: { prefix: 'supabase' },
})
