// Event handlers. The audit log consumes no events: callers write their row through `record()`
// inside their own transaction, so the action and its row commit or roll back together.
export {}
