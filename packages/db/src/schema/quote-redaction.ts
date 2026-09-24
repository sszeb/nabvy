import { moduleSchema } from '../module-schema'

// Tables of the quote-redaction module, all in the Postgres schema 'quote_redaction' (packages/db/README.md).
// Only services/quote-redaction writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate quote-redaction

export const schema = moduleSchema('quote-redaction')
