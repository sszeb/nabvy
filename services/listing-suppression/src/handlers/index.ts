// Event handlers. This module consumes no events: its one write is `add()`, which only
// `seller-rights` calls, and resolution happens in SQL when a view reads `is_suppressed()`
// (README.md, "Inputs"). Handlers of other modules re-check their listings on
// `listing-suppression.changed`.
export {}
