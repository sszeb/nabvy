// No event handlers: this module consumes no events (docs/design/modules/product-catalogue.md,
// "Inputs": pack data and admin edits only). Its writes are `addItem`/`addAlias`/
// `addNegativeContext`/`addCode` in ../index.ts, called from an admin procedure, and the pack seed
// migration (packages/db/migrations/product-catalogue/); see README.md, "Decisions".
export {}
