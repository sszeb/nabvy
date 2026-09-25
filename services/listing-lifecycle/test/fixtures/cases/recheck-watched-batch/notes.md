# recheck-watched-batch (synthetic)

Watched listings are refreshed in daily batches of 20 or more
(`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:190-191`): 19 due watched rechecks wait; the
20th releases all 20 to details-queue at `shortlisted` priority, reason `recheck`.
