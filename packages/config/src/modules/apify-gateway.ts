import { z } from 'zod'

// Thresholds of the apify-gateway module (rule 14 of docs/design/modules/_rules.md), validated with
// Zod like the env groups in ../env.ts. The gateway's money limits (cap, reservation bounds, build
// pin) live in the database, in apify_gateway.settings, where the Edge Function enforces them.

const apifyGatewayConfig = z.object({
  watchBatchSize: z.number().int().min(1).max(500),
})

const config = apifyGatewayConfig.parse({
  /**
   * Jobs the watcher handles per step and tick (metering, run-collected, run-settled). Basis:
   * pipeline work runs in batches of 100–500 (CLAUDE.md, "Batches, not items"); a run job is one
   * row, so the lower bound keeps a tick short. Status: starting value; nothing queues more than a
   * few jobs a minute before the test hunt measures it.
   */
  watchBatchSize: 100,
})

export const APIFY_GATEWAY_WATCH_BATCH_SIZE = config.watchBatchSize
