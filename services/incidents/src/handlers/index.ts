// Event handlers. Each takes a batch (100–500 items), is idempotent (key
// source + sourceListingId + contentHash) and stamps its T-timestamps (CLAUDE.md).
//
// incidents consumes no other module's events (docs/design/modules/incidents.md, "Depends on:
// none"). The task wrapper calls `record()` directly once an event has failed all its retries;
// an admin calls `retry()` directly. Neither is triggered by an event handler here.
export {}
